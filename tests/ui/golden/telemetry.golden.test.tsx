import { describe, expect, it } from "bun:test";
import { buildTelemetryViewModel } from "../../../src/ui/logic/telemetry-state";
import { Telemetry } from "../../../src/ui/screens/telemetry";
import { DEFAULT_THEME } from "../../../src/ui/themes";
import { expectGoldenFrame } from "./harness";

const theme = DEFAULT_THEME;

function vm(overrides: Partial<Parameters<typeof buildTelemetryViewModel>[0]>) {
	return buildTelemetryViewModel({
		phase: "READY",
		model: "qwen2.5-coder-32b-q4_k_m.gguf",
		endpoint: "http://127.0.0.1:8080",
		startedAtMs: 1000,
		nowMs: 61_000,
		telemetryEnabled: true,
		vramEstimatedBytes: { low: 20e9, high: 24e9 },
		memUsedBytes: 12e9,
		kvUsageRatio: 0.42,
		promptHistory: [110, 120, 130, 125],
		decodeHistory: [22, 24, 26, 25],
		slots: [
			{ id: 0, state: "ACTIVE", promptTokens: 128, generating: true },
			{ id: 1, state: "IDLE", promptTokens: 0, generating: false },
		],
		failure: null,
		tailLines: [],
		...overrides,
	});
}

describe("telemetry screen golden frames", () => {
	it("ready state: header, gauges, sparklines, slots table", async () => {
		await expectGoldenFrame(
			"telemetry-ready",
			<Telemetry theme={theme} vm={vm({})} />,
			{ width: 100, height: 28 },
		);
	});

	it("dormant state when telemetry disabled (P5-FR-06)", async () => {
		await expectGoldenFrame(
			"telemetry-dormant",
			<Telemetry
				theme={theme}
				vm={vm({ telemetryEnabled: false })}
				onEnableTelemetry={() => {}}
			/>,
			{ width: 100, height: 28 },
		);
	});

	it("FAILED state surfaces summary, fix, tail (P5-FR-15)", async () => {
		await expectGoldenFrame(
			"telemetry-failed",
			<Telemetry
				theme={theme}
				vm={vm({
					phase: "FAILED",
					failure: {
						summary: "CUDA out of memory during model load (OOM)",
						suggestion: "Lower -ngl / -c, or quantize KV cache",
					},
					tailLines: [
						"llm_load_tensors: failed to allocate CUDA0 buffer",
						"[ERR] process exited with code 1",
					],
				})}
			/>,
			{ width: 100, height: 28 },
		);
	});

	it("slot states render distinctly (ACTIVE vs IDLE)", async () => {
		const active = vm({});
		expect(active.slotRows[0]?.join()).not.toBe(active.slotRows[1]?.join());
	});
});
