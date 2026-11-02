import { describe, expect, it } from "bun:test";
import { GIB } from "../../src/core/estimate/vram";
import type { HardwareInfo } from "../../src/core/hardware/detect";
import {
	createConfigurator,
	setFlag,
	solveAutoFitNgl,
	willItFitVerdict,
} from "../../src/ui/logic/configurator-state";

const MODEL = {
	path: "~/models/llm/qwen25-7b-q4km.gguf",
	blockCount: 28,
	contextLength: 131072,
	fileSize: 4_681_378_816,
	headCount: 28,
	headCountKv: 4,
	embeddingLength: 3584,
};

describe("will-it-fit verdict and auto-fit ngl (Issue #8)", () => {
	describe("willItFitVerdict", () => {
		it("returns 'fits' verdict with headroom when model fits in VRAM", () => {
			// ctx pinned: scenario targets the verdict boundary, not the
			// model-native default (#9).
			const state = setFlag(createConfigurator(MODEL), "ctx_size", 4096);
			const hw: HardwareInfo = {
				kind: "nvidia",
				vramBytes: 8 * GIB,
				totalMemBytes: 32 * GIB,
				source: "nvidia-smi",
			};

			const verdict = willItFitVerdict(state, hw);
			expect(verdict.status).toBe("fits");
			expect(verdict.text).toContain("GPU → fits, ~");
			expect(verdict.text).toContain("headroom");
		});

		it("returns 'no-fit' verdict when model exceeds VRAM", () => {
			const state = createConfigurator(MODEL);
			const hw: HardwareInfo = {
				kind: "nvidia",
				vramBytes: 4 * GIB,
				totalMemBytes: 32 * GIB,
				source: "nvidia-smi",
			};

			const verdict = willItFitVerdict(state, hw);
			expect(verdict.status).toBe("no-fit");
			expect(verdict.text).toContain("GPU → will not fit as configured");
		});

		it("returns 'no-data' verdict when hardware probe data is missing or CPU only", () => {
			const state = createConfigurator(MODEL);
			const verdictNull = willItFitVerdict(state, null);
			expect(verdictNull.status).toBe("no-data");
			expect(verdictNull.text).toBe("hardware probe failed — run reprobe");

			const hwCpu: HardwareInfo = {
				kind: "cpu",
				vramBytes: null,
				totalMemBytes: 16 * GIB,
				source: "os.totalmem",
			};
			const verdictCpu = willItFitVerdict(state, hwCpu);
			expect(verdictCpu.status).toBe("no-data");
			expect(verdictCpu.text).toBe("no GPU detected (CPU-only system)");
		});
	});

	describe("solveAutoFitNgl", () => {
		it("returns nglMax when VRAM is abundant", () => {
			const state = createConfigurator(MODEL);
			const hw = { kind: "nvidia", vramBytes: 24 * GIB } as HardwareInfo;
			const result = solveAutoFitNgl(state, hw);
			expect(result.fits).toBe(true);
			expect(result.ngl).toBe(state.nglMax);
		});

		it("solves max ngl that fits when VRAM is constrained", () => {
			// ctx pinned: scenario targets the ngl solve, not the default (#9).
			const state = setFlag(createConfigurator(MODEL), "ctx_size", 4096);
			// 5.5 GiB is enough for partial offload but not full 29 layers
			const hw = { kind: "nvidia", vramBytes: Math.floor(5.5 * GIB) } as HardwareInfo;
			const result = solveAutoFitNgl(state, hw);
			expect(result.fits).toBe(true);
			expect(result.ngl).toBeGreaterThan(0);
			expect(result.ngl).toBeLessThan(state.nglMax);
		});

		it("flags when even ngl=0 exceeds VRAM and suggests ctx reduction", () => {
			const state = createConfigurator(MODEL);
			// Very low VRAM (100 MiB) cannot even hold KV cache / overhead at default ctx
			const hw = { kind: "nvidia", vramBytes: 100 * 1024 * 1024 } as HardwareInfo;
			const result = solveAutoFitNgl(state, hw);
			expect(result.fits).toBe(false);
			expect(result.ngl).toBe(0);
			expect(result.message).toContain("reduce context size");
		});

		it("respects monotonic invariant across various VRAM constraints (property test)", () => {
			const state = createConfigurator(MODEL);
			// Test increasing VRAM levels; solved ngl must be monotonically non-decreasing
			let prevNgl = 0;
			for (let gib = 2; gib <= 16; gib += 1) {
				const hw = { kind: "nvidia", vramBytes: gib * GIB } as HardwareInfo;
				const result = solveAutoFitNgl(state, hw);
				if (result.fits) {
					expect(result.ngl).toBeGreaterThanOrEqual(prevNgl);
					prevNgl = result.ngl;
				}
			}
		});
	});
});
