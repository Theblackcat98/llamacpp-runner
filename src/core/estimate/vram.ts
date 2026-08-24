/**
 * GQA-aware VRAM estimator (§3.2). PURE: no I/O, no globals; deterministic
 * for identical inputs (P3-NFR-04). Output is always a RANGE (P3-FR-13).
 */
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
	kvQuant?: KvQuant;
}

export type KvQuant = "f16" | "q8_0" | "q4_0";

const BYTES_PER_ELEM: Record<KvQuant, number> = {
	f16: 2.0,
	q8_0: 1.0,
	q4_0: 0.5625,
};

export const GIB = 1024 * 1024 * 1024;
const OVERHEAD_LOW = 300 * 1024 * 1024;
const OVERHEAD_HIGH = 800 * 1024 * 1024;
const COMPUTE_MIN_GIB = 0.5;
const COMPUTE_MAX_GIB = 2;
const CTX_BASELINE = 8192;

export interface VramRange {
	low: number;
	high: number;
}

function clamp(v: number, lo: number, hi: number): number {
	return Math.min(Math.max(v, lo), hi);
}

/**
 * Compute buffer grows with sqrt(ctx) relative to an 8k baseline and doubles
 * at the high end to account for larger batch sizes.
 */
function computeBuffer(contextLength: number): { min: number; max: number } {
	const scale = Math.sqrt(
		clamp(contextLength, 1, Number.MAX_SAFE_INTEGER) / CTX_BASELINE,
	);
	const min = clamp(COMPUTE_MIN_GIB * scale, COMPUTE_MIN_GIB, COMPUTE_MAX_GIB);
	const max = clamp(
		2 * COMPUTE_MIN_GIB * scale,
		COMPUTE_MIN_GIB,
		COMPUTE_MAX_GIB,
	);
	return { min: min * GIB, max: max * GIB };
}

/** kv_bytes = 2 × n_layers × n_ctx × n_kv_heads × head_dim × bytes_per_elem */
export function kvCacheBytes(input: EstimateInput): number {
	const headDim = input.keyLength ?? input.embeddingLength / input.headCount;
	const bytesPerElem = BYTES_PER_ELEM[input.kvQuant ?? "f16"];
	return (
		2 *
		input.blockCount *
		input.contextLength *
		input.headCountKv *
		headDim *
		bytesPerElem
	);
}

export function estimateVram(input: EstimateInput): VramRange {
	const headDim = input.keyLength ?? input.embeddingLength / input.headCount;
	void headDim;
	const kv = kvCacheBytes(input);
	const offloadedWeights =
		input.fileSize * (input.gpuLayers / (input.blockCount + 1));
	const compute = computeBuffer(input.contextLength);
	return {
		low: offloadedWeights + kv + compute.min + OVERHEAD_LOW,
		high: offloadedWeights + kv + compute.max + OVERHEAD_HIGH,
	};
}

export function estimateFromModelInfo(
	info: ModelInfo,
	fileSize: number,
	gpuLayers: number,
	contextLength: number,
): VramRange | null {
	if (
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

export function formatBytes(bytes: number): string {
	const gb = bytes / GIB;
	if (gb >= 1) return `${gb.toFixed(1)} GB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
