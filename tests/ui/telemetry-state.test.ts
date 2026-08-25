import { describe, expect, it } from "bun:test";
import {
	buildTelemetryViewModel,
	type TelemetryInputs,
} from "../../src/ui/logic/telemetry-state";

const BASE: TelemetryInputs = {
	phase: "READY",
	model: "qwen2.5-coder-32b-q4_k_m.gguf",
	endpoint: "http://127.0.0.1:8080",
	startedAtMs: 1000,
	nowMs: 61_000,
	telemetryEnabled: true,
	vramEstimatedBytes: { low: 20e9, high: 24e9 },
	memUsedBytes: 12e9,
	kvUsageRatio: 0.42,
	promptHistory: [100, 200, 300],
	decodeHistory: [10, 20, 30],
	slots: [
		{ id: 0, state: "ACTIVE", promptTokens: 128, generating: true },
		{ id: 1, state: "IDLE", promptTokens: 0, generating: false },
	],
	failure: null,
	tailLines: [],
};

describe("buildTelemetryViewModel (P5-FR-04)", () => {
	it("status header: badge color class per phase", () => {
		expect(buildTelemetryViewModel(BASE).badge).toBe("ok");
		expect(buildTelemetryViewModel({ ...BASE, phase: "FAILED" }).badge).toBe(
			"error",
		);
		expect(buildTelemetryViewModel({ ...BASE, phase: "LOADING" }).badge).toBe(
			"warn",
		);
	});

	it("uptime formats as h/m/s", () => {
		expect(buildTelemetryViewModel(BASE).uptime).toBe("1m 0s");
		const hours = buildTelemetryViewModel({
			...BASE,
			nowMs: 1000 + 3_600_000 + 120_000 + 5_000,
		});
		expect(hours.uptime).toBe("1h 2m 5s");
	});

	it("no server -> idle dashes", () => {
		const vm = buildTelemetryViewModel({
			...BASE,
			phase: "IDLE",
			startedAtMs: null,
		});
		expect(vm.uptime).toBe("-");
	});

	it("VRAM gauge = actual / estimated high, capped at 1", () => {
		const vm = buildTelemetryViewModel(BASE);
		expect(vm.vramFraction).toBeCloseTo(0.5);
		expect(vm.vramLabel).toContain("12.0 GB actual / 24.0 GB est");
		const over = buildTelemetryViewModel({ ...BASE, memUsedBytes: 48e9 });
		expect(over.vramFraction).toBe(1);
	});

	it("KV ratio gauge clamped to [0,1]", () => {
		expect(buildTelemetryViewModel(BASE).kvFraction).toBeCloseTo(0.42);
	});

	it("sparklines render block glyphs from history", () => {
		const vm = buildTelemetryViewModel(BASE);
		expect(vm.promptSpark.length).toBe(3);
		expect(vm.decodeSpark.length).toBe(3);
	});

	it("slots table rows include id, state, prompt tokens, gen flag", () => {
		const vm = buildTelemetryViewModel(BASE);
		expect(vm.slotRows).toEqual([
			["0", "ACTIVE", "128", "*"],
			["1", "IDLE", "0", ""],
		]);
	});

	it("dormant state when telemetry flags disabled (P5-FR-06)", () => {
		const vm = buildTelemetryViewModel({ ...BASE, telemetryEnabled: false });
		expect(vm.dormant).toBe(true);
	});

	it("FAILED surfaces failure summary + suggestion + tail lines (P5-FR-15)", () => {
		const vm = buildTelemetryViewModel({
			...BASE,
			phase: "FAILED",
			failure: {
				summary: "CUDA out of memory during model load (OOM)",
				suggestion: "Lower -ngl / -c, or quantize KV cache",
			},
			tailLines: ["err line 1", "err line 2"],
		});
		expect(vm.failureSummary).toContain("out of memory");
		expect(vm.failureSuggestion).toContain("-ngl");
		expect(vm.errorTail).toEqual(["err line 1", "err line 2"]);
	});

	it("latest tps values come from history heads", () => {
		const vm = buildTelemetryViewModel(BASE);
		expect(vm.promptTpsLabel).toContain("300");
		expect(vm.decodeTpsLabel).toContain("30");
	});
});
