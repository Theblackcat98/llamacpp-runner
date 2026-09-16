import { describe, expect, it } from "bun:test";
import { buildTelemetryViewModel } from "../../src/ui/logic/telemetry-state";
import { Telemetry } from "../../src/ui/screens/telemetry";
import { TOKYO_NIGHT } from "../../src/ui/themes";
import { renderWithAct, teardownWithAct } from "./golden/harness";

type VmArgs = Parameters<typeof buildTelemetryViewModel>[0];

function readyVm(overrides: Partial<VmArgs> = {}) {
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

async function renderTelemetry(vm: ReturnType<typeof readyVm>) {
	const setup = await renderWithAct(
		<Telemetry theme={TOKYO_NIGHT} vm={vm} width={100} />,
		{ width: 100, height: 28 },
	);
	const frame = setup.captureCharFrame();
	await teardownWithAct(setup);
	return frame.split("\n");
}

const BOX_CHARS = /[┌┐└┘─│╔╗╚╝═║╭╮╰╯]/;

describe("telemetry screen re-layout (#45)", () => {
	it("folds status into a 1-line borderless strip at the top", async () => {
		const rows = await renderTelemetry(readyVm());
		const strip = rows[0] ?? "";
		expect(strip).toContain("qwen2.5-coder-32b-q4_k_m.gguf");
		expect(strip).toContain("127.0.0.1:8080");
		expect(strip).not.toMatch(BOX_CHARS);
		// No separate 3-row STATUS box follows the strip.
		expect(rows[1] ?? "").not.toContain("STATUS");
	});

	it("lays the VRAM and KV gauges side by side", async () => {
		const rows = await renderTelemetry(readyVm());
		const gaugeRow = rows.find((r) => r.includes("VRAM") && r.includes("KV"));
		expect(gaugeRow).toBeDefined();
	});

	it("scales gauges beyond the old fixed 24-wide bars", async () => {
		const rows = await renderTelemetry(readyVm({}));
		const gaugeRow = (rows.find((r) => r.includes("VRAM")) ?? "").replace(
			/\s+/g,
			" ",
		);
		// At 100 cols the VRAM bar alone should be wider than the legacy 24.
		const bar = gaugeRow.match(/\[([█░]+)\]/);
		expect(bar).not.toBeNull();
		expect((bar?.[1] ?? "").length).toBeGreaterThan(24);
	});

	it("has no all-caps titled boxes", async () => {
		const rows = await renderTelemetry(readyVm());
		const frame = rows.join("\n");
		for (const title of [
			"STATUS",
			"METERS",
			"THROUGHPUT",
			"SLOTS (--slots)",
			"SERVER TELEMETRY",
		]) {
			expect(frame).not.toContain(title);
		}
	});

	it("keeps sparklines and the slots table", async () => {
		const rows = await renderTelemetry(readyVm());
		const frame = rows.join("\n");
		expect(frame).toContain("prompt");
		expect(frame).toContain("decode");
		expect(frame).toContain("ID");
		expect(frame).toContain("ACTIVE");
	});

	it("dormant state renders borderless without chrome", async () => {
		const rows = await renderTelemetry(
			readyVm({ telemetryEnabled: false, phase: "IDLE" }),
		);
		const frame = rows.join("\n");
		expect(frame).toContain("telemetry disabled");
		expect(frame).not.toContain("SERVER TELEMETRY");
		expect(frame).not.toMatch(BOX_CHARS);
	});

	it("failure state still surfaces summary, fix, and tail", async () => {
		const rows = await renderTelemetry(
			readyVm({
				phase: "FAILED",
				failure: {
					summary: "CUDA out of memory during model load (OOM)",
					suggestion: "Lower -ngl / -c, or quantize KV cache",
				},
				tailLines: ["llm_load_tensors: failed to allocate CUDA0 buffer"],
			}),
		);
		const frame = rows.join("\n");
		expect(frame).toContain("CUDA out of memory");
		expect(frame).toContain("Lower -ngl");
		expect(frame).toContain("failed to allocate");
		expect(frame).not.toContain("FAILURE (§6.4)");
	});
});
