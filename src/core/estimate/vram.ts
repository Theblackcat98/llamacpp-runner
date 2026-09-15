/**
 * GQA-aware VRAM estimator (§3.2). PURE: no I/O, no globals; deterministic
 * for identical inputs (P3-NFR-04). Output is always a RANGE (P3-FR-13).
 *
 * Phase 12:
 *  - K and V caches are computed independently, each sized by its own
 *    quantization (cache_type_k / cache_type_v can differ).
 *  - compute buffer responds to batch/ubatch, not just context.
 *  - a machine-readable `limitations` note ships with the estimate so the UI
 *    can be honest about architecture-dependent uncertainty.
 */

import {
	ESTIMATE_BATCH_BASELINE,
	ESTIMATE_COMPUTE_MAX_GIB,
	ESTIMATE_COMPUTE_MIN_GIB,
	ESTIMATE_CTX_BASELINE,
	ESTIMATE_OVERHEAD_HIGH,
	ESTIMATE_OVERHEAD_LOW,
	ESTIMATE_UBATCH_BASELINE,
} from "../constants";
import type { ModelInfo } from "../gguf/types";

export interface EstimateInput {
	fileSize: number;
	blockCount: number;
	contextLength: number;
	headCount: number;
	headCountKv: number;
	embeddingLength: number;
	/** Explicit attention head dim, e.g. Gemma 256 / DeepSeek2 MLA 192. */
	keyLength?: number;
	gpuLayers: number;
	/** K-cache quantization (defaults f16). */
	kvQuantK?: KvQuant;
	/** V-cache quantization (defaults f16). */
	kvQuantV?: KvQuant;
	/** Batch size; drives the compute-buffer upper bound (defaults 2048). */
	batchSize?: number;
	/** Micro-batch (uppb) size (defaults 512). */
	ubatchSize?: number;
}

export type KvQuant = "f16" | "q8_0" | "q4_0";

const BYTES_PER_ELEM: Record<KvQuant, number> = {
	f16: 2.0,
	q8_0: 1.0,
	q4_0: 0.5625,
};

export const GIB = 1024 * 1024 * 1024;

export interface VramRange {
	low: number;
	high: number;
}

/** Architecture-dependent caveats attached to an estimate (Phase 12). */
export interface EstimateLimitation {
	code: string;
	message: string;
}

export interface VramEstimate {
	range: VramRange;
	kvBytes: number;
	kvBytesK: number;
	kvBytesV: number;
	limitations: EstimateLimitation[];
}

function clamp(v: number, lo: number, hi: number): number {
	return Math.min(Math.max(v, lo), hi);
}

/** Bytes for a single (K or V) cache at the given quantization. */
function cacheBytes(input: EstimateInput, quant: KvQuant): number {
	const headDim = input.keyLength ?? input.embeddingLength / input.headCount;
	return (
		input.blockCount *
		input.contextLength *
		input.headCountKv *
		headDim *
		BYTES_PER_ELEM[quant]
	);
}

/**
 * K + V caches, each sized by its own quantization. Total is K + V so a
 * mixed config (e.g. K=q8_0, V=f16) is reflected exactly (Phase 12).
 */
export function kvCacheBytes(input: EstimateInput): {
	k: number;
	v: number;
	total: number;
} {
	const k = cacheBytes(input, input.kvQuantK ?? "f16");
	const v = cacheBytes(input, input.kvQuantV ?? "f16");
	return { k, v, total: k + v };
}

/**
 * Compute buffer grows with sqrt(ctx) and sqrt(batch) relative to baselines.
 * Keep uppercase indicates the buffer assumes decode (prompt is transient).
 * Returns bytes.
 */
function computeBuffer(
	contextLength: number,
	batchSize: number,
	ubatchSize: number,
): { min: number; max: number } {
	const ctxScale = Math.sqrt(
		clamp(contextLength, 1, Number.MAX_SAFE_INTEGER) / ESTIMATE_CTX_BASELINE,
	);
	const batchScale = Math.sqrt(
		clamp(batchSize, 1, Number.MAX_SAFE_INTEGER) / ESTIMATE_BATCH_BASELINE,
	);
	const ubatchScale = Math.sqrt(
		clamp(Math.min(ubatchSize, batchSize), 1, Number.MAX_SAFE_INTEGER) /
			ESTIMATE_UBATCH_BASELINE,
	);
	const scale = ctxScale * batchScale * ubatchScale;
	const min = clamp(
		ESTIMATE_COMPUTE_MIN_GIB * scale,
		ESTIMATE_COMPUTE_MIN_GIB,
		ESTIMATE_COMPUTE_MAX_GIB,
	);
	const max = clamp(
		2 * ESTIMATE_COMPUTE_MIN_GIB * scale,
		ESTIMATE_COMPUTE_MIN_GIB,
		ESTIMATE_COMPUTE_MAX_GIB,
	);
	return { min: min * GIB, max: max * GIB };
}

/** Estimate entry point returning the range + K/V split + limitation notes. */
export function estimateVram(input: EstimateInput): VramEstimate {
	const kv = kvCacheBytes(input);
	const offloadedWeights =
		input.fileSize * (input.gpuLayers / (input.blockCount + 1));
	const compute = computeBuffer(
		input.contextLength,
		input.batchSize ?? ESTIMATE_BATCH_BASELINE,
		input.ubatchSize ?? ESTIMATE_UBATCH_BASELINE,
	);

	const limitations: EstimateLimitation[] = [];
	// Compute buffer is architecture/backend dependent (CUDA vs Metal vs
	// CPU); we report it as an envelope rather than a precise value.
	limitations.push({
		code: "compute-envelope",
		message:
			"compute buffers vary by backend/batch; estimated as 0.5–2 GiB scaling with ctx × batch",
	});
	if (input.keyLength !== undefined) {
		limitations.push({
			code: "explicit-head-dim",
			message: `using explicit head_dim=${input.keyLength} (e.g. MLA/GQA variants may not match this linear model`,
		});
	}
	if (input.kvQuantK === "q4_0" || input.kvQuantV === "q4_0") {
		limitations.push({
			code: "q4-kv-lossy",
			message: "q4_0 KV is lossy and its real footprint is backend-dependent",
		});
	}
	if (input.fileSize <= 0) {
		limitations.push({
			code: "missing-file-size",
			message: "model missing — estimate unavailable",
		});
	}

	return {
		range: {
			low: offloadedWeights + kv.total + compute.min + ESTIMATE_OVERHEAD_LOW,
			high: offloadedWeights + kv.total + compute.max + ESTIMATE_OVERHEAD_HIGH,
		},
		kvBytes: kv.total,
		kvBytesK: kv.k,
		kvBytesV: kv.v,
		limitations,
	};
}

export function estimateFromModelInfo(
	info: ModelInfo,
	fileSize: number,
	gpuLayers: number,
	contextLength: number,
): VramEstimate | null {
	if (
		fileSize <= 0 ||
		info.blockCount === undefined ||
		info.headCount === undefined ||
		info.headCountKv === undefined ||
		info.embeddingLength === undefined
	) {
		return null;
	}
	return estimateVram({
		fileSize,
		blockCount: info.blockCount,
		contextLength,
		headCount: info.headCount,
		headCountKv: info.headCountKv,
		embeddingLength: info.embeddingLength,
		keyLength: info.keyLength,
		gpuLayers,
	});
}

/** Binary-unit labels — the estimator works in GiB, say so (Phase 12). */
export function formatBytes(bytes: number): string {
	const gib = bytes / GIB;
	if (gib >= 1) return `${gib.toFixed(1)} GiB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
