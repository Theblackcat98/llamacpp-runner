import { describe, expect, it } from "bun:test";
import {
	type EstimateInput,
	estimateVram,
	formatBytes,
	GIB,
	kvCacheBytes,
} from "../src/core/estimate/vram";

function llama2_7b(overrides: Partial<EstimateInput> = {}): EstimateInput {
	return {
		fileSize: 3_897_308_464,
		blockCount: 32,
		contextLength: 4096,
		headCount: 32,
		headCountKv: 32,
		embeddingLength: 4096,
		gpuLayers: 33,
		...overrides,
	};
}

describe("VRAM estimator: formula (P3-FR-12)", () => {
	it("computes GQA kv_bytes with derived head_dim", () => {
		const input = llama2_7b({ headCountKv: 8 });
		const r = estimateVram(input);
		const weights = 3_897_308_464;
		const kv = 2 * 32 * 4096 * 8 * 128 * 2;
		const expectedLow = weights + kv + 0.5 * GIB + 300 * 1024 * 1024;
		expect(r.range.low).toBeCloseTo(expectedLow, 0);
	});

	it("uses explicit key_length when present (gemma-style)", () => {
		const shared = llama2_7b({ headCountKv: 4 });
		const explicitKv = kvCacheBytes({ ...shared, keyLength: 256 });
		const derivedKv = kvCacheBytes(shared);
		expect(explicitKv.total / derivedKv.total).toBeCloseTo(256 / 128, 8);
	});

	it("MHA estimates exceed GQA by the head ratio", () => {
		const mha = estimateVram(llama2_7b());
		const gqa = estimateVram(llama2_7b({ headCountKv: 8 }));
		expect(mha.range.low).toBeGreaterThan(gqa.range.low);
	});
});

describe("VRAM estimator: range output (P3-FR-13/14)", () => {
	it("high endpoint = weights + kv + compute_max + 800MB overhead", () => {
		const input = llama2_7b();
		const r = estimateVram(input);
		const kv = kvCacheBytes(input).total;
		// ctx=4096 -> scale sqrt(0.5) -> compute max = 2*0.5*sqrt(0.5) GiB
		const computeMax = Math.sqrt(0.5) * GIB;
		expect(r.range.high - input.fileSize - kv).toBeCloseTo(
			computeMax + 800 * 1024 * 1024,
			0,
		);
	});

	it("offloads a fraction ngl/(block_count+1) of file size", () => {
		const r = estimateVram(llama2_7b({ gpuLayers: 16, contextLength: 512 }));
		const halfWeights = (input_size() * 16) / 33;
		const kv = 2 * 32 * 512 * 32 * 128 * 2;
		expect(r.range.low).toBeCloseTo(
			halfWeights + kv + 0.5 * GIB + 300 * 1024 * 1024,
			0,
		);
	});

	function input_size() {
		return 3_897_308_464;
	}
});

describe("VRAM estimator: real-world config table (§8)", () => {
	interface Row {
		label: string;
		input: EstimateInput;
		gibRange: [number, number];
		tolerance: number;
	}

	const TABLE: Row[] = [
		// Llama-2-7B Q4_K_M fully offloaded @ 4k ctx: measured ~6.5-7.5 GiB
		{
			label: "llama-2-7b q4_k_m ngl=33 ctx=4096",
			input: llama2_7b(),
			gibRange: [6.5, 8.5],
			tolerance: 1.0,
		},
		// TinyLlama-1.1B Q8_0 (~1.14 GB), 22 layers, GQA 32/4, emb 2048 -> head_dim 64
		{
			label: "tinyllama-1.1b q8_0 ngl=23 ctx=2048",
			input: {
				fileSize: 1_137_571_840,
				blockCount: 22,
				contextLength: 2048,
				headCount: 32,
				headCountKv: 4,
				embeddingLength: 2048,
				gpuLayers: 23,
			},
			gibRange: [1.6, 3.2],
			tolerance: 0.6,
		},
		// DeepSeek-V2-Lite Q4_K_M (~8.9 GB), 27 layers, MLA key_length 192
		{
			label: "deepseek2-lite q4_k_m ngl=28 ctx=4096",
			input: {
				fileSize: 8_907_243_520,
				blockCount: 27,
				contextLength: 4096,
				headCount: 16,
				headCountKv: 16,
				keyLength: 192,
				embeddingLength: 2048,
				gpuLayers: 28,
			},
			gibRange: [9.5, 13],
			tolerance: 1.5,
		},
	];

	for (const row of TABLE) {
		it(`${row.label} lands within tolerance`, () => {
			const r = estimateVram(row.input);
			const lowGib = r.range.low / GIB;
			const highGib = r.range.high / GIB;
			expect(lowGib).toBeGreaterThanOrEqual(row.gibRange[0] - row.tolerance);
			expect(highGib).toBeLessThanOrEqual(row.gibRange[1] + row.tolerance);
		});
	}
});

describe("VRAM estimator: properties (§8, P3-NFR-04)", () => {
	it("output is always a valid non-degenerate range", () => {
		for (const ctx of [512, 4096, 32768, 131072]) {
			for (const ngl of [0, 8, 33]) {
				const r = estimateVram(
					llama2_7b({ contextLength: ctx, gpuLayers: ngl }),
				);
				expect(r.range.low).toBeGreaterThan(0);
				expect(r.range.high).toBeGreaterThan(r.range.low);
			}
		}
	});

	it("monotonic non-decreasing in ctx", () => {
		let prevLow = 0;
		let prevHigh = 0;
		for (const ctx of [1024, 4096, 16384, 65536]) {
			const r = estimateVram(llama2_7b({ contextLength: ctx }));
			expect(r.range.low).toBeGreaterThanOrEqual(prevLow);
			expect(r.range.high).toBeGreaterThanOrEqual(prevHigh);
			prevLow = r.range.low;
			prevHigh = r.range.high;
		}
	});

	it("monotonic non-decreasing in ngl", () => {
		let prevLow = 0;
		for (const ngl of [0, 11, 22, 33]) {
			const r = estimateVram(llama2_7b({ gpuLayers: ngl }));
			expect(r.range.low).toBeGreaterThanOrEqual(prevLow);
			prevLow = r.range.low;
		}
	});

	it("deterministic for identical inputs", () => {
		const a = estimateVram(llama2_7b());
		const b = estimateVram(llama2_7b());
		expect(a).toEqual(b);
	});
});

describe("VRAM estimator: Phase 12 independent K/V + batch + labels", () => {
	it("K and V caches are sized independently by their own quant", () => {
		const base = llama2_7b();
		const bothF16 = kvCacheBytes(base);
		const kvDiff = kvCacheBytes({
			...base,
			kvQuantK: "q8_0",
			kvQuantV: "q4_0",
		});
		// Same total geometry, but K now 1 B/elem and V now 0.5625 B/elem.
		const perElem = 32 * 4096 * 32 * 128;
		expect(kvDiff.k).toBeCloseTo(perElem * 1.0, 0);
		expect(kvDiff.v).toBeCloseTo(perElem * 0.5625, 0);
		expect(kvDiff.total).toBeLessThan(bothF16.total);
	});

	it("batch/ubatch increase the compute-buffer upper bound", () => {
		const small = estimateVram(llama2_7b({ batchSize: 512, ubatchSize: 128 }));
		const big = estimateVram(llama2_7b({ batchSize: 8192, ubatchSize: 2048 }));
		expect(big.range.high).toBeGreaterThan(small.range.high);
	});

	it("ships a machine-readable limitations note with the estimate", () => {
		const r = estimateVram(llama2_7b({ keyLength: 192, kvQuantV: "q4_0" }));
		expect(r.limitations.length).toBeGreaterThan(0);
		expect(r.limitations.some((l) => l.code === "compute-envelope")).toBe(true);
		expect(r.limitations.some((l) => l.code === "explicit-head-dim")).toBe(
			true,
		);
		expect(r.limitations.some((l) => l.code === "q4-kv-lossy")).toBe(true);
	});
});

describe("formatBytes", () => {
	it("labels binary quantities as GiB/MiB (Phase 12)", () => {
		expect(formatBytes(21.1 * GIB)).toMatch(/^21\.1 GiB$/);
		expect(formatBytes(0.9 * GIB)).toBe("921.6 MiB");
		expect(formatBytes(2 * GIB)).toBe("2.0 GiB");
	});
});
