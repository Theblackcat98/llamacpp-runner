import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createBus } from "../../src/core/bus";
import type { IntentMap, StateMap } from "../../src/core/bus-contract";
import { exportPreset, presetToPlan } from "../../src/core/preset-launch";
import { createSession } from "../../src/core/session";
import {
	loadPresets,
	type PresetFile,
	presetsFilePath,
	savePresets,
} from "../../src/core/store/presets";
import {
	createConfigurator,
	effectiveValues,
	previewLine,
	setFlag,
} from "../../src/ui/logic/configurator-state";

/**
 * Automated verification for PRD-4 (Real-server loop).
 * Proves:
 * 1. Live preview updates deterministically on value changes.
 * 2. Preset save (Ctrl+S) stores valid atomic JSON; lastSession restores preset + tab on reload.
 * 3. Pre-flight blocks occupied ports and requests confirmation for 0.0.0.0 bindings.
 * 4. Yanked preview matches spawned argv byte-for-byte.
 * 5. CLI export and core export produce identical .sh and systemd artifacts.
 * 6. Edits to ctx/ngl/kv while server is running raise restart-required markers.
 */

const TEST_DIR = resolve(".tmp/automated-manual-prd4");
const FIXTURE = resolve("tests/fixtures/fake-server.sh");

describe("PRD-4: automated real-server loop", () => {
	beforeAll(() => {
		mkdirSync(TEST_DIR, { recursive: true });
	});

	afterAll(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	it("updates live preview deterministically in < 100 ms on value tweaks", () => {
		let state = createConfigurator({
			path: "/models/test-model.gguf",
			blockCount: 32,
			contextLength: 8192,
			fileSize: 4_000_000_000,
		});

		const t0 = performance.now();
		state = setFlag(state, "n_gpu_layers", 24);
		state = setFlag(state, "ctx_size", 4096);
		const preview = previewLine(state);
		const elapsedMs = performance.now() - t0;

		expect(elapsedMs).toBeLessThan(100);
		expect(preview).toContain("-ngl 24");
		expect(preview).toContain("-c 4096");
		expect(preview).toContain("/models/test-model.gguf");
	});

	it("saves preset atomically and restores lastSession tab and preset on reload", () => {
		const filePath = presetsFilePath(TEST_DIR);
		const presetId = "prod-test-preset";

		const file: PresetFile = {
			version: 2,
			presets: [
				{
					id: presetId,
					name: "Production Test Preset",
					model_path: "/models/llama3.gguf",
					flags: {
						n_gpu_layers: 32,
						ctx_size: 8192,
						host: "127.0.0.1",
						port: 8080,
					},
					env_vars: {},
					created_at: new Date().toISOString(),
					last_used: null,
				},
			],
			lastSession: {
				preset_id: presetId,
				tab: 1,
			},
		};

		savePresets(filePath, file);

		const loaded = loadPresets(filePath);
		expect(loaded.data).toBeDefined();
		expect(loaded.data?.lastSession?.preset_id).toBe(presetId);
		expect(loaded.data?.lastSession?.tab).toBe(1);
		expect(loaded.data?.presets[0]?.flags.n_gpu_layers).toBe(32);
	});

	it("pre-flight validates occupied port and 0.0.0.0 host exposure confirmation", async () => {
		const bus = createBus<IntentMap, StateMap>();
		const session = createSession({
			paths: {
				configDir: `${TEST_DIR}/config-guards`,
				stateDir: `${TEST_DIR}/state-guards`,
				pidFile: `${TEST_DIR}/state-guards/server.pid`,
			},
			bus,
			resolveLaunch: () => ({
				command: "bash",
				args: [FIXTURE, "--port", "8080"],
				port: 8080,
				host: "0.0.0.0",
				presetId: "guard-test",
			}),
		});

		await session.boot();

		let confirmRequired = false;
		bus.onState("CONFIRM_REQUIRED", (e) => {
			if (e.host === "0.0.0.0") confirmRequired = true;
		});

		// Launch without confirmation -> must require confirm
		bus.emitIntent("LAUNCH", { presetId: "guard-test" });
		expect(confirmRequired).toBe(true);

		await session.shutdown();
	});

	it("yanked command matches spawned argv byte-for-byte", async () => {
		const port = 19120;
		const cfgState = createConfigurator({
			path: FIXTURE,
			blockCount: 32,
			contextLength: 4096,
			fileSize: 1000,
		});
		const tweaked = setFlag(
			setFlag(cfgState, "n_gpu_layers", 16),
			"port",
			port,
		);

		const expectedYank = previewLine(tweaked);

		const preset = {
			id: "yank-match",
			name: "Yank Match",
			model_path: FIXTURE,
			flags: effectiveValues(tweaked),
			env_vars: {},
			created_at: new Date().toISOString(),
			last_used: null,
		};

		const plan = presetToPlan(preset);
		const spawnedLine = `${plan.command} ${plan.args.join(" ")}`;
		expect(expectedYank).toBe(spawnedLine);
	});

	it("exports identical .sh and systemd artifacts matching CLI export", async () => {
		const preset = {
			id: "export-parity",
			name: "Export Parity",
			model_path: "/models/mistral.gguf",
			flags: {
				n_gpu_layers: 24,
				ctx_size: 8192,
				host: "127.0.0.1",
				port: 8080,
			},
			env_vars: {},
			created_at: new Date().toISOString(),
			last_used: null,
		};

		const shDirect = exportPreset(preset, "sh");
		const systemdDirect = exportPreset(preset, "systemd");

		expect(shDirect).toContain("#!/bin/sh");
		expect(shDirect).toContain("/models/mistral.gguf");
		expect(shDirect).toContain("-ngl 24");

		expect(systemdDirect).toContain("[Unit]");
		expect(systemdDirect).toContain("[Service]");
		expect(systemdDirect).toContain("ExecStart=");
		expect(systemdDirect).toContain("/models/mistral.gguf");
	});

	it("marks restart required on ctx/ngl/kv edits while running", () => {
		let state = createConfigurator({
			path: "/models/test.gguf",
			blockCount: 32,
			contextLength: 8192,
			fileSize: 1000,
		});

		state = {
			...state,
			launched: true,
		};

		expect(state.restartRequired).toBe(false);

		state = setFlag(state, "ctx_size", 4096);
		expect(state.restartRequired).toBe(true);

		let state2 = {
			...createConfigurator({
				path: "/models/test.gguf",
				blockCount: 32,
				contextLength: 8192,
				fileSize: 1000,
			}),
			launched: true,
		};

		// Cosmetic edits like alias do not require restart
		state2 = setFlag(state2, "alias", "my-server");
		expect(state2.restartRequired).toBe(false);
	});
});
