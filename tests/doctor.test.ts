/**
 * doctor diagnostic (Issue #24): test-first contract for
 * `buildDoctorReport` in src/core/doctor.ts.
 *
 * All external effects (binary --help probe, GGUF parse, hardware detect,
 * pidfile inspection) are injected via DoctorDeps so these tests are fully
 * deterministic: no spawned processes, no real hardware, no network.
 */
import { describe, expect, it } from "bun:test";
import {
	buildDoctorReport,
	type DoctorDeps,
	type DoctorPaths,
	formatDoctorReport,
} from "../src/core/doctor";
import type { Preset } from "../src/core/store/presets";

const PATHS: DoctorPaths = {
	configDir: "/tmp/doctor-test/config",
	stateDir: "/tmp/doctor-test/state",
	pidFile: "/tmp/doctor-test/state/server.pid",
};

function basePreset(overrides: Partial<Preset> = {}): Preset {
	return {
		id: "preset-1",
		name: "Test preset",
		model_path: "/models/qwen.gguf",
		flags: { ctx_size: 4096, n_gpu_layers: 20 },
		env_vars: {},
		created_at: "2026-09-16T00:00:00.000Z",
		last_used: null,
		...overrides,
	};
}

const MODEL_INFO = {
	architecture: "qwen3",
	quantName: "Q4_K_M",
	totalParams: 32_500_000_000,
	contextLength: 131072,
	blockCount: 64,
	embeddingLength: 5120,
	headCount: 40,
	headCountKv: 8,
	keyLength: 128,
};

function baseDeps(overrides: Partial<DoctorDeps> = {}): DoctorDeps {
	return {
		now: () => "2026-09-16T10:00:00.000Z",
		fileExists: () => true,
		probeBinary: async () => ({
			resolvedPath: "/usr/bin/llama-server",
			helpText: "usage: llama-server",
			availability: {},
			verified: true,
		}),
		readModelInfo: async () => ({
			info: { ...MODEL_INFO },
			fileSize: 20 * 1024 * 1024 * 1024,
		}),
		detectHardware: async () => ({
			kind: "nvidia",
			vramBytes: 24 * 1024 * 1024 * 1024,
			totalMemBytes: 64 * 1024 * 1024 * 1024,
			source: "test",
		}),
		inspectProcess: async () => ({ status: "none", pid: null }),
		splitCheck: () => null,
		...overrides,
	};
}

describe("doctor report (Issue #24)", () => {
	it("reports a launchable preset with exact argv, estimate, and no blockers", async () => {
		const report = await buildDoctorReport(
			{ preset: basePreset() },
			PATHS,
			baseDeps(),
		);

		expect(report.schema).toBe("llama-deck.doctor/v1");
		expect(report.generatedAt).toBe("2026-09-16T10:00:00.000Z");
		expect(report.target).toEqual({
			kind: "preset",
			id: "preset-1",
			name: "Test preset",
		});
		expect(report.binary.status).toBe("ok");
		expect(report.binary.path).toBe("/usr/bin/llama-server");
		expect(report.binary.helpVerified).toBe(true);

		expect(report.model.exists).toBe(true);
		expect(report.model.metadata?.architecture).toBe("qwen3");
		expect(report.model.metadata?.quantName).toBe("Q4_K_M");
		expect(report.model.incompleteSplit).toBeNull();

		// Exact final argv without executing: -m first, ctx + ngl present.
		expect(report.plan.args[0]).toBe("-m");
		expect(report.plan.args[1]).toBe("/models/qwen.gguf");
		expect(report.plan.commandLine).toContain("-m /models/qwen.gguf");
		expect(report.plan.commandLine).toContain("-c 4096");
		expect(report.plan.host).toBe("127.0.0.1");
		expect(report.plan.port).toBe(8080);

		// VRAM estimate with clearly marked limitations.
		expect(report.estimate).not.toBeNull();
		expect(report.estimate?.vramRangeBytes.low).toBeGreaterThan(0);
		expect(report.estimate?.vramRangeBytes.high).toBeGreaterThanOrEqual(
			report.estimate?.vramRangeBytes.low ?? 0,
		);
		expect(Array.isArray(report.estimate?.limitations)).toBe(true);

		// Telemetry endpoint derived from the plan.
		expect(report.telemetry.enabled).toBe(true);
		expect(report.telemetry.endpoint).toBe("http://127.0.0.1:8080");

		expect(report.blockers).toEqual([]);
		expect(report.launchable).toBe(true);
	});

	it("marks a missing binary as a blocker and still reports the plan", async () => {
		const report = await buildDoctorReport(
			{ preset: basePreset() },
			PATHS,
			baseDeps({
				probeBinary: async () => ({
					resolvedPath: null,
					helpText: "",
					availability: {},
					verified: false,
				}),
			}),
		);

		expect(report.binary.status).toBe("missing");
		expect(report.binary.path).toBeNull();
		expect(report.launchable).toBe(false);
		expect(report.blockers.some((b) => b.includes("binary"))).toBe(true);
		// The would-be argv is still reported for debugging.
		expect(report.plan.commandLine).toContain("-m /models/qwen.gguf");
	});

	it("drops unsupported flags from argv and surfaces them as warnings", async () => {
		const report = await buildDoctorReport(
			{ preset: basePreset() },
			PATHS,
			baseDeps({
				probeBinary: async () => ({
					resolvedPath: "/usr/bin/llama-server",
					helpText: "usage: llama-server",
					availability: {
						n_gpu_layers: { supported: false, deprecated: false },
					},
					verified: true,
				}),
			}),
		);

		expect(report.plan.commandLine).not.toContain("n-gpu-layers");
		expect(
			report.warnings.some(
				(w) => w.includes("n_gpu_layers") && w.includes("not supported"),
			),
		).toBe(true);
		// Unsupported flags warn; they do not block.
		expect(report.launchable).toBe(true);
	});

	it("marks an incomplete split group as a blocker", async () => {
		const report = await buildDoctorReport(
			{ preset: basePreset() },
			PATHS,
			baseDeps({
				splitCheck: () => 'incomplete split group "qwen" — have 1 of 3 parts',
			}),
		);

		expect(report.model.incompleteSplit).toContain("have 1 of 3 parts");
		expect(report.launchable).toBe(false);
		expect(report.blockers.some((b) => b.includes("incomplete split"))).toBe(
			true,
		);
	});

	it("surfaces malformed preset values as warnings with effective values", async () => {
		const report = await buildDoctorReport(
			{
				preset: basePreset({
					flags: { n_gpu_layers: "banana", ctx_size: -5 },
				}),
			},
			PATHS,
			baseDeps(),
		);

		expect(report.warnings.some((w) => w.includes("expected an integer"))).toBe(
			true,
		);
		expect(report.warnings.some((w) => w.includes("clamped"))).toBe(true);
		// Effective (post-validation) values are reported.
		expect(report.flags.effective.ctx_size).toBe(0);
		expect(report.launchable).toBe(true);
	});

	it("marks a missing model file as a blocker with no estimate", async () => {
		const report = await buildDoctorReport(
			{ preset: basePreset() },
			PATHS,
			baseDeps({ fileExists: () => false }),
		);

		expect(report.model.exists).toBe(false);
		expect(report.model.metadata).toBeNull();
		expect(report.estimate).toBeNull();
		expect(report.launchable).toBe(false);
		expect(
			report.blockers.some((b) => b.includes("model file not found")),
		).toBe(true);
	});

	it("marks an already-running managed server as a blocker", async () => {
		const report = await buildDoctorReport(
			{ preset: basePreset() },
			PATHS,
			baseDeps({
				inspectProcess: async () => ({ status: "alive", pid: 1234 }),
			}),
		);

		expect(report.process.status).toBe("alive");
		expect(report.process.pid).toBe(1234);
		expect(report.launchable).toBe(false);
		expect(report.blockers.some((b) => b.includes("already running"))).toBe(
			true,
		);
	});

	it("warns when the plan binds all interfaces", async () => {
		const report = await buildDoctorReport(
			{ preset: basePreset({ flags: { host: "0.0.0.0" } }) },
			PATHS,
			baseDeps(),
		);

		expect(report.plan.host).toBe("0.0.0.0");
		expect(report.warnings.some((w) => w.includes("all interfaces"))).toBe(
			true,
		);
		expect(report.launchable).toBe(true);
	});

	it("warns (not blocks) when model metadata is unreadable", async () => {
		const report = await buildDoctorReport(
			{ preset: basePreset() },
			PATHS,
			baseDeps({
				readModelInfo: async () => {
					throw new Error("parse failed");
				},
			}),
		);

		expect(report.model.metadata).toBeNull();
		expect(report.estimate).toBeNull();
		expect(report.warnings.some((w) => w.includes("metadata unreadable"))).toBe(
			true,
		);
		expect(report.launchable).toBe(true);
	});

	it("is deterministic: identical inputs produce byte-identical JSON", async () => {
		const deps = baseDeps();
		const a = await buildDoctorReport({ preset: basePreset() }, PATHS, deps);
		const b = await buildDoctorReport({ preset: basePreset() }, PATHS, deps);
		expect(JSON.stringify(a)).toBe(JSON.stringify(b));
	});

	it("exposes a schema-stable top-level shape for scripting", async () => {
		const report = await buildDoctorReport(
			{ preset: basePreset() },
			PATHS,
			baseDeps(),
		);
		const json = JSON.parse(JSON.stringify(report)) as Record<string, unknown>;
		for (const key of [
			"schema",
			"generatedAt",
			"target",
			"binary",
			"model",
			"flags",
			"plan",
			"estimate",
			"telemetry",
			"process",
			"blockers",
			"warnings",
			"launchable",
		]) {
			expect(key in json, `missing top-level key: ${key}`).toBe(true);
		}
	});

	it("renders a human-readable summary with verdict", async () => {
		const ok = await buildDoctorReport(
			{ preset: basePreset() },
			PATHS,
			baseDeps(),
		);
		const text = formatDoctorReport(ok);
		expect(text).toContain("LAUNCHABLE");
		expect(text).toContain("/usr/bin/llama-server");

		const blocked = await buildDoctorReport(
			{ preset: basePreset() },
			PATHS,
			baseDeps({ fileExists: () => false }),
		);
		expect(formatDoctorReport(blocked)).toContain("NOT LAUNCHABLE");
	});
});
