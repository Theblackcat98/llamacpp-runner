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
		expect(r.low).toBeCloseTo(expectedLow, 0);
	});

	it("uses explicit key_length when present (gemma-style)", () => {
		const shared = llama2_7b({ headCountKv: 4 });
		const explicitKv = kvCacheBytes({ ...shared, keyLength: 256 });
		const derivedKv = kvCacheBytes(shared);
		expect(explicitKv / derivedKv).toBeCloseTo(256 / 128, 8);
	});

	it("MHA estimates exceed GQA by the head ratio", () => {
		const mha = estimateVram(llama2_7b());
		const gqa = estimateVram(llama2_7b({ headCountKv: 8 }));
		expect(mha.low).toBeGreaterThan(gqa.low);
	});
});

describe("VRAM estimator: range output (P3-FR-13/14)", () => {
	it("high endpoint = weights + kv + compute_max + 800MB overhead", () => {
		const input = llama2_7b();
		const r = estimateVram(input);
		const kv = kvCacheBytes(input);
		// ctx=4096 -> scale sqrt(0.5) -> compute max = 2*0.5*sqrt(0.5) GiB
		const computeMax = Math.sqrt(0.5) * GIB;
		expect(r.high - input.fileSize - kv).toBeCloseTo(
			computeMax + 800 * 1024 * 1024,
			0,
		);
	});

	it("offloads a fraction ngl/(block_count+1) of file size", () => {
		const r = estimateVram(llama2_7b({ gpuLayers: 16, contextLength: 512 }));
		const halfWeights = (input_size() * 16) / 33;
		const kv = 2 * 32 * 512 * 32 * 128 * 2;
		expect(r.low).toBeCloseTo(
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
			const lowGib = r.low / GIB;
			const highGib = r.high / GIB;
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
				expect(r.low).toBeGreaterThan(0);
				expect(r.high).toBeGreaterThan(r.low);
			}
		}
	});

	it("monotonic non-decreasing in ctx", () => {
		let prevLow = 0;
		let prevHigh = 0;
		for (const ctx of [1024, 4096, 16384, 65536]) {
			const r = estimateVram(llama2_7b({ contextLength: ctx }));
			expect(r.low).toBeGreaterThanOrEqual(prevLow);
			expect(r.high).toBeGreaterThanOrEqual(prevHigh);
			prevLow = r.low;
			prevHigh = r.high;
		}
	});

	it("monotonic non-decreasing in ngl", () => {
		let prevLow = 0;
		for (const ngl of [0, 11, 22, 33]) {
			const r = estimateVram(llama2_7b({ gpuLayers: ngl }));
			expect(r.low).toBeGreaterThanOrEqual(prevLow);
			prevLow = r.low;
		}
	});

	it("deterministic for identical inputs", () => {
		const a = estimateVram(llama2_7b());
		const b = estimateVram(llama2_7b());
		expect(a).toEqual(b);
	});
});

describe("formatBytes", () => {
	it("formats GiB-range values for the 'estimated range' label", () => {
		expect(formatBytes(21.1 * GIB)).toMatch(/^21\.1 GB$/);
		expect(formatBytes(0.9 * GIB)).toBe("921.6 MB");
		expect(formatBytes(2 * GIB)).toBe("2.0 GB");
	});
});
