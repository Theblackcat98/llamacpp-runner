/**
 * Auto-fit VRAM layer solver (§3.2, Issue #8, Issue #10).
 * PURE: no I/O, no globals; deterministic binary search over monotonic VRAM estimates.
 */

import type { EstimateInput, KvQuant } from "./vram";
import { estimateVram } from "./vram";

export interface AutoFitInput {
	fileSize: number;
	blockCount: number;
	contextLength: number;
	headCount: number;
	headCountKv: number;
	embeddingLength: number;
	keyLength?: number;
	kvQuantK?: KvQuant;
	kvQuantV?: KvQuant;
	batchSize?: number;
	ubatchSize?: number;
}

export interface AutoFitResult {
	ngl: number;
	fits: boolean;
	message?: string;
}

/**
 * Solves the maximum n_gpu_layers that fits within available VRAM.
 *
 * Monotonicity assumption:
 * estimateVram is monotonically non-decreasing in gpuLayers, as offloading
 * an additional layer moves tensor weights from system RAM to VRAM while
 * other memory buffers (compute, context KV) stay constant or expand.
 * We can thus use binary search across [0, maxNgl] in O(log(maxNgl)) steps.
 */
export function computeAutoFitNgl(
	input: AutoFitInput,
	vramBytes: number | null | undefined,
	maxNgl: number = input.blockCount + 1,
): AutoFitResult {
	if (vramBytes === null || vramBytes === undefined || vramBytes <= 0) {
		return {
			ngl: maxNgl,
			fits: false,
			message: "no hardware data — run reprobe",
		};
	}
	if (
		!input.fileSize ||
		input.fileSize <= 0 ||
		input.blockCount === undefined ||
		!input.headCount ||
		input.headCountKv === undefined ||
		!input.embeddingLength
	) {
		return {
			ngl: maxNgl,
			fits: false,
			message: "missing model metadata",
		};
	}

	const testNgl = (ngl: number): boolean => {
		const estInput: EstimateInput = {
			...input,
			gpuLayers: ngl,
		};
		const est = estimateVram(estInput);
		return est.range.high <= vramBytes;
	};

	if (testNgl(maxNgl)) {
		return { ngl: maxNgl, fits: true };
	}

	if (!testNgl(0)) {
		return {
			ngl: 0,
			fits: false,
			message: "even ngl=0 exceeds VRAM — reduce context size",
		};
	}

	let low = 0;
	let high = maxNgl;
	let best = 0;

	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		if (testNgl(mid)) {
			best = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}

	return { ngl: best, fits: true };
}
