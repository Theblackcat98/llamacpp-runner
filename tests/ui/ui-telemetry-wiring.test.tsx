import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { buildTelemetryViewModel } from "../../src/ui/logic/telemetry-state";
import { Telemetry } from "../../src/ui/screens/telemetry";
import { DEFAULT_THEME } from "../../src/ui/themes";

describe("telemetry UI wiring and error handling (P0, P1, P2)", () => {
	it("renders duplicate stderr tail lines without key collision (P2)", async () => {
		const vm = buildTelemetryViewModel({
			phase: "FAILED",
			model: "test.gguf",
			endpoint: "http://127.0.0.1:8080",
			startedAtMs: 1000,
			nowMs: 5000,
			telemetryEnabled: true,
			vramEstimatedBytes: null,
			memUsedBytes: null,
			kvUsageRatio: null,
			promptHistory: [],
			decodeHistory: [],
			slots: [],
			failure: { summary: "CUDA out of memory", suggestion: "reduce ctx" },
			// Duplicate lines that would collide with key={line}
			tailLines: [
				"repeating error line",
				"repeating error line",
				"repeating error line",
			],
		});

		const setup = await testRender(
			<Telemetry theme={DEFAULT_THEME} vm={vm} />,
			{ width: 100, height: 30 },
		);
		await act(async () => {
			await setup.flush();
		});

		const frame = setup.captureCharFrame();
		expect(frame).toContain("CUDA out of memory");
		expect(frame).toContain("repeating error line");
		await act(async () => {
			setup.renderer.destroy();
		});
	});

	it("telemetry VM formats real elapsed uptime from startedAtMs (P0)", () => {
		const startedAt = 100_000;
		const now = 165_000; // 65 seconds later
		const vm = buildTelemetryViewModel({
			phase: "READY",
			model: "test.gguf",
			endpoint: "http://127.0.0.1:8080",
			startedAtMs: startedAt,
			nowMs: now,
			telemetryEnabled: true,
			vramEstimatedBytes: null,
			memUsedBytes: null,
			kvUsageRatio: null,
			promptHistory: [],
			decodeHistory: [],
			slots: [],
			failure: null,
			tailLines: [],
		});
		expect(vm.uptime).toBe("1m 5s");
	});

	it("telemetry VM reflects classified failure and tail lines (P1)", () => {
		const vm = buildTelemetryViewModel({
			phase: "FAILED",
			model: "test.gguf",
			endpoint: "http://127.0.0.1:8080",
			startedAtMs: 1000,
			nowMs: 5000,
			telemetryEnabled: true,
			vramEstimatedBytes: null,
			memUsedBytes: null,
			kvUsageRatio: null,
			promptHistory: [],
			decodeHistory: [],
			slots: [],
			failure: { summary: "port in use", suggestion: "try next port" },
			tailLines: ["err line 1", "err line 2"],
		});
		expect(vm.failureSummary).toBe("port in use");
		expect(vm.failureSuggestion).toBe("try next port");
		expect(vm.errorTail).toEqual(["err line 1", "err line 2"]);
	});
});
