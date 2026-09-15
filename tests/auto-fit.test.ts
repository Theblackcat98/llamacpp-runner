import { describe, expect, it } from "bun:test";
import {
	type AutoFitInput,
	computeAutoFitNgl,
} from "../src/core/estimate/auto-fit";
import { GIB } from "../src/core/estimate/vram";

const BASE_INPUT: AutoFitInput = {
	fileSize: 4 * GIB,
	blockCount: 32,
	contextLength: 4096,
	headCount: 32,
	headCountKv: 4,
	embeddingLength: 4096,
	kvQuantK: "f16",
	kvQuantV: "f16",
};

describe("computeAutoFitNgl (§3.2, Issue #8, Issue #10)", () => {
	it("returns maxNgl when VRAM is abundant", () => {
		const result = computeAutoFitNgl(BASE_INPUT, 24 * GIB);
		expect(result.fits).toBe(true);
		expect(result.ngl).toBe(33); // 32 + 1
	});

	it("returns failure and suggestions when even ngl=0 exceeds VRAM", () => {
		const result = computeAutoFitNgl(BASE_INPUT, 10 * 1024 * 1024);
		expect(result.fits).toBe(false);
		expect(result.ngl).toBe(0);
		expect(result.message).toContain("reduce context size");
	});

	it("handles missing hardware or VRAM gracefully", () => {
		const result = computeAutoFitNgl(BASE_INPUT, null);
		expect(result.fits).toBe(false);
		expect(result.ngl).toBe(33);
		expect(result.message).toContain("no hardware data");
	});

	it("handles missing model metadata gracefully", () => {
		const incompleteInput = { ...BASE_INPUT, fileSize: 0 };
		const result = computeAutoFitNgl(incompleteInput, 16 * GIB);
		expect(result.fits).toBe(false);
		expect(result.message).toContain("missing model metadata");
	});

	it("respects monotonic invariant across VRAM constraints", () => {
		let prevNgl = 0;
		for (let gib = 2; gib <= 16; gib += 1) {
			const result = computeAutoFitNgl(BASE_INPUT, gib * GIB);
			if (result.fits) {
				expect(result.ngl).toBeGreaterThanOrEqual(prevNgl);
				prevNgl = result.ngl;
			}
		}
	});
});
