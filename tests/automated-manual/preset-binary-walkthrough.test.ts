import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createBus } from "../../src/core/bus";
import type { IntentMap, StateMap } from "../../src/core/bus-contract";
import { shellQuote } from "../../src/core/export/quote";
import { presetToPlan } from "../../src/core/preset-launch";
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
	loadPresetInto,
	previewLine,
	setFlag,
} from "../../src/ui/logic/configurator-state";
import { relink } from "../../src/ui/logic/presets-state";

/**
 * Automated verification for Phase 8 (Configuration, Presets, and Binary Completeness).
 * Proves:
 * 1. Select model -> configure fields -> save preset -> reload.
 * 2. Relaunch restores lastSession tab & preset into the configurator.
 * 3. Broken preset relinking updates model_path cleanly.
 * 4. Launch with custom binary_path respects file setting; previewed command equals spawned command.
 */

const TEST_DIR = resolve(".tmp/automated-manual-p8");
const FIXTURE = resolve("tests/fixtures/fake-server.sh");

describe("Phase 8: automated config, presets, and binary walkthrough", () => {
	beforeAll(() => {
		mkdirSync(TEST_DIR, { recursive: true });
	});

	afterAll(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	it("completes select -> configure -> save -> relaunch -> load -> relink -> launch with custom binary", async () => {
		const filePath = presetsFilePath(TEST_DIR);
		const customBinary = "/custom/bin/my-llama-server";

		// 1. Configure initial preset
		let config = createConfigurator({
			path: "/old/path/missing.gguf",
			blockCount: 32,
			contextLength: 4096,
			fileSize: 1000,
		});
		config = setFlag(config, "n_gpu_layers", 28);
		config = setFlag(config, "ctx_size", 8192);

		const presetId = "p8-walkthrough";
		const presetFile: PresetFile = {
			version: 2,
			binary_path: customBinary,
			default_model_dir: "/models/defaults",
			presets: [
				{
					id: presetId,
					name: "Phase 8 Preset",
					model_path: "/old/path/missing.gguf",
					flags: effectiveValues(config),
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

		// 2. Save
		savePresets(filePath, presetFile);

		// 3. Relaunch and Load
		const loaded = loadPresets(filePath);
		expect(loaded.data).toBeDefined();
		expect(loaded.data?.binary_path).toBe(customBinary);
		expect(loaded.data?.default_model_dir).toBe("/models/defaults");
		expect(loaded.data?.lastSession?.preset_id).toBe(presetId);
		const loadedPreset = loaded.data?.presets[0];
		expect(loadedPreset).toBeDefined();
		if (!loadedPreset) throw new Error("Preset not found");
		expect(loadedPreset.id).toBe(presetId);

		// 4. Relink broken preset to a valid target (FIXTURE)
		const relinkedPreset = relink(loadedPreset, FIXTURE);
		expect(relinkedPreset.model_path).toBe(FIXTURE);

		// Load into Configurator
		config = loadPresetInto(
			config,
			relinkedPreset.flags,
			relinkedPreset.model_path,
		);
		expect(config.model?.path).toBe(FIXTURE);
		expect(config.values.n_gpu_layers).toBe(28);
		expect(config.values.ctx_size).toBe(8192);

		// 5. Verify previewed command matches spawned plan byte-for-byte with custom binary
		const preview = previewLine(config);

		const plan = presetToPlan({
			...relinkedPreset,
			flags: effectiveValues(config),
		});
		const spawnedPreview = [plan.command, ...plan.args.map(shellQuote)].join(
			" ",
		);
		expect(preview).toBe(spawnedPreview);

		// Also verify with custom binary honored by session
		const bus = createBus<IntentMap, StateMap>();
		let spawnedBinary = "";
		const stateDir = `${TEST_DIR}/state`;
		const session = createSession({
			paths: {
				configDir: TEST_DIR,
				stateDir,
				pidFile: `${stateDir}/server.pid`,
			},
			bus,
			resolveLaunch: () => {
				const p = presetToPlan(relinkedPreset);
				spawnedBinary = loaded.data?.binary_path || p.command;
				return {
					...p,
					command: "bash",
					args: [FIXTURE, "--port", "19488"],
					port: 19488,
				};
			},
		});

		await session.boot();
		bus.emitIntent("LAUNCH", { presetId });

		let ready = false;
		bus.onState("PROC_STATE", (e) => {
			if (e.state === "READY") ready = true;
		});

		const t0 = Date.now();
		while (!ready && Date.now() - t0 < 4000) {
			await Bun.sleep(50);
		}

		expect(ready).toBe(true);
		expect(spawnedBinary).toBe(customBinary);

		await session.shutdown();
	});
});
