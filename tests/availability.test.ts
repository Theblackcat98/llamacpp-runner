import { describe, expect, it } from "bun:test";
import { assessAvailability } from "../src/core/flags/availability";
import { buildCommand } from "../src/core/flags/builder";
import { sanitizeValues } from "../src/core/flags/validate-values";

/** Phase 12: runtime --help validation must gate what can launch. */
describe("assessAvailability", () => {
	it("drops unsupported flags and warns on deprecated ones", () => {
		const avail = {
			ctx_size: { supported: true, deprecated: false },
			flash_attn: { supported: true, deprecated: false },
			n_gpu_layers: { supported: false, deprecated: false },
			mlock: { supported: true, deprecated: true },
		};
		const verdict = assessAvailability(
			["ctx_size", "n_gpu_layers", "mlock", "flash_attn"],
			avail,
		);
		expect(verdict.dropped.map((d) => d.id)).toEqual(["n_gpu_layers"]);
		expect(verdict.dropped[0]?.reason).toBe("unsupported");
		expect(verdict.warned.map((w) => w.id)).toEqual(["mlock"]);
		expect(verdict.warned[0]?.reason).toBe("deprecated");
		expect(verdict.unsupportedCount).toBe(1);
	});

	it("unknown ids are ignored, unknown availability keeps the flag", () => {
		const verdict = assessAvailability(["ctx_size", "not_a_flag"], {
			ctx_size: { supported: true, deprecated: false },
		});
		expect(verdict.dropped).toEqual([]);
		expect(verdict.warned).toEqual([]);
	});
});

describe("buildCommand with availability (Phase 12)", () => {
	it("drops unsupported flags from argv before launch", () => {
		const { args } = buildCommand({
			modelPath: "m.gguf",
			values: { ctx_size: 4096, flash_attn: true, n_gpu_layers: 65 },
			availability: {
				ctx_size: { supported: true, deprecated: false },
				flash_attn: { supported: false, deprecated: false },
				n_gpu_layers: { supported: true, deprecated: false },
			},
		});
		expect(args).toContain("-c");
		expect(args).not.toContain("--flash-attn");
		expect(args).toContain("-ngl");
	});

	it("drops auto-injected telemetry flags when the binary lacks them", () => {
		const { args } = buildCommand({
			modelPath: "m.gguf",
			values: {},
			availability: {
				slots: { supported: false, deprecated: false },
				metrics: { supported: false, deprecated: false },
			},
		});
		expect(args).not.toContain("--slots");
		expect(args).not.toContain("--metrics");
	});

	it("behaves identically to the golden suite when availability is absent", () => {
		const a = buildCommand({
			modelPath: "m.gguf",
			values: { ctx_size: 4096, flash_attn: true },
		}).args;
		const b = buildCommand({
			modelPath: "m.gguf",
			values: { ctx_size: 4096, flash_attn: true },
			availability: {},
		}).args;
		expect(a).toEqual(b);
	});
});

/** Phase 12: hand-edited values are clamped before command generation. */
describe("sanitizeValues", () => {
	it("clamps out-of-range ints to the registry range", () => {
		const result = sanitizeValues({ port: 1, ctx_size: -5 });
		expect(result.clamped.port).toBe(1024);
		expect(result.clamped.ctx_size).toBe(0);
		expect(
			result.issues.some(
				(i) => i.id === "port" && i.message.includes("clamped"),
			),
		).toBe(true);
	});

	it("clamps ngl to meta:block_count+1", () => {
		const result = sanitizeValues({ n_gpu_layers: 999 }, { blockCount: 31 });
		expect(result.clamped.n_gpu_layers).toBe(32);
	});

	it("rejects invalid enums and non-integer ints as issues", () => {
		const result = sanitizeValues({ cache_type_k: "fp8", port: "abc" });
		expect(result.issues.some((i) => i.id === "cache_type_k")).toBe(true);
		expect(result.issues.some((i) => i.id === "port")).toBe(true);
	});

	it("leaves valid values untouched", () => {
		const result = sanitizeValues({
			port: 8080,
			ctx_size: 4096,
			alias: "qwen",
		});
		expect(result.clamped.port).toBe(8080);
		expect(result.issues).toEqual([]);
	});
});
