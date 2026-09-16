/**
 * CLI wiring for `llama-deck doctor` (Issue #24): spawns the real cli.ts
 * against scratch XDG dirs and asserts the diagnostic contract end to end.
 * The --help probe uses the deterministic dummy-help.sh fixture; hardware
 * is mocked to CPU in config so detection never touches the host.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { saveConfig } from "../src/core/store/config";
import {
	type PresetFile,
	presetsFilePath,
	savePresets,
} from "../src/core/store/presets";
import { sampleLlamaQ4Km } from "./fixtures/gguf/build";

const TMP = resolve(import.meta.dir, ".tmp/cli-doctor");
const CONFIG_DIR = join(TMP, "config");
const STATE_DIR = join(TMP, "state");
const DECK_CONFIG_DIR = join(CONFIG_DIR, "llama-deck");
const DUMMY_HELP = resolve("tests/fixtures/help/dummy-help.sh");

function cliEnv(): Record<string, string> {
	return {
		...process.env,
		XDG_CONFIG_HOME: CONFIG_DIR,
		XDG_STATE_HOME: STATE_DIR,
	} as Record<string, string>;
}

function runDoctor(args: string[]) {
	return Bun.spawnSync([process.execPath, "src/cli.ts", "doctor", ...args], {
		env: cliEnv(),
	});
}

describe("CLI doctor (Issue #24)", () => {
	const modelPath = join(TMP, "sample.gguf");

	beforeAll(() => {
		mkdirSync(DECK_CONFIG_DIR, { recursive: true });
		mkdirSync(STATE_DIR, { recursive: true });
		writeFileSync(modelPath, sampleLlamaQ4Km().buffer);
		// Mock CPU hardware so detection never probes the host.
		saveConfig(DECK_CONFIG_DIR, {
			theme: "tokyo-night",
			hardware: {
				kind: "cpu",
				vramBytes: null,
				totalMemBytes: 16 * 1024 * 1024 * 1024,
				source: "cpu-fallback",
			},
		});
		const doc: PresetFile = {
			version: 2,
			presets: [
				{
					id: "preset-doc",
					name: "Doctor preset",
					model_path: modelPath,
					flags: { ctx_size: 2048, n_gpu_layers: 0 },
					env_vars: {},
					created_at: "2026-09-16T00:00:00.000Z",
					last_used: null,
				},
			],
		};
		savePresets(presetsFilePath(DECK_CONFIG_DIR), doc);
	});

	afterAll(() => {
		rmSync(TMP, { recursive: true, force: true });
	});

	it("--json emits the schema-stable report and exits 1 when blocked", () => {
		const proc = runDoctor(["preset-doc", "--json"]);
		expect(proc.exitCode).toBe(1);
		const report = JSON.parse(proc.stdout.toString());
		expect(report.schema).toBe("llama-deck.doctor/v1");
		expect(report.target).toEqual({
			kind: "preset",
			id: "preset-doc",
			name: "Doctor preset",
		});
		// No binary_path configured and llama-server is not on PATH here.
		expect(report.binary.status).toBe("missing");
		expect(report.launchable).toBe(false);
		expect(report.blockers.length).toBeGreaterThan(0);
		// Exact argv is still reported without executing anything.
		expect(report.plan.commandLine).toContain(`-m ${modelPath}`);
		expect(report.model.exists).toBe(true);
	});

	it("human-readable output carries the verdict", () => {
		const proc = runDoctor(["preset-doc"]);
		const out = proc.stdout.toString();
		expect(out).toContain("doctor: preset");
		expect(out).toContain("NOT LAUNCHABLE");
		expect(out).toContain("binary:");
	});

	it("exits 1 for an unknown preset", () => {
		const proc = runDoctor(["nope", "--json"]);
		expect(proc.exitCode).toBe(1);
		expect(proc.stderr.toString()).toContain("Unknown preset");
	});

	it("exits 1 with usage when no preset is given", () => {
		const proc = runDoctor([]);
		expect(proc.exitCode).toBe(1);
		expect(proc.stderr.toString()).toContain("Usage: llama-deck doctor");
	});

	it("verifies --help against the configured binary when present", () => {
		const doc: PresetFile = {
			version: 2,
			presets: [
				{
					id: "preset-help",
					name: "Help preset",
					model_path: modelPath,
					flags: { ctx_size: 2048, n_gpu_layers: 0 },
					env_vars: {},
					created_at: "2026-09-16T00:00:00.000Z",
					last_used: null,
				},
			],
			binary_path: DUMMY_HELP,
		};
		savePresets(presetsFilePath(DECK_CONFIG_DIR), doc);

		const proc = runDoctor(["preset-help", "--json"]);
		expect(proc.exitCode).toBe(0);
		const report = JSON.parse(proc.stdout.toString());
		expect(report.binary.status).toBe("ok");
		expect(report.binary.path).toBe(DUMMY_HELP);
		expect(report.binary.helpVerified).toBe(true);
		expect(report.launchable).toBe(true);
		expect(report.telemetry.endpoint).toBe("http://127.0.0.1:8080");
	});
});
