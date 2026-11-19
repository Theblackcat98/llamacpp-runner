import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createBus } from "../../src/core/bus";
import type { IntentMap, StateMap } from "../../src/core/bus-contract";
import { createModelsService } from "../../src/core/models/service";
import { createSession, type LaunchPlan } from "../../src/core/session";
import { saveConfig } from "../../src/core/store/config";
import {
	loadPresets,
	presetsFilePath,
	savePresets,
} from "../../src/core/store/presets";
import { resolvePaths } from "../../src/core/store/state-paths";
import { SessionApp } from "../../src/main";
import { sampleLlamaQ4Km, writeFixture } from "../fixtures/gguf/build";
import { renderWithAct, teardownWithAct } from "./golden/harness";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const TMP_BASE = join(PROJECT_ROOT, ".tmp");

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const fn of cleanups.splice(0)) await fn();
});

/**
 * Tier 3: `L` on the Presets tab loads the preset AND launches it in one
 * action. The launch plan must come from the preset just loaded — the
 * plan resolver runs in the same tick as the load, before any re-render.
 */
describe("load & launch composition (Tier 3)", () => {
	it("L emits LAUNCH and the resolved plan carries the preset's values", async () => {
		mkdirSync(TMP_BASE, { recursive: true });
		const scratch = mkdtempSync(join(TMP_BASE, "loadlaunch-"));
		const configDir = join(scratch, "config", "llama-deck");
		const modelsDir = join(scratch, "models");
		mkdirSync(configDir, { recursive: true });
		mkdirSync(modelsDir, { recursive: true });
		writeFixture(modelsDir, "alpha.gguf", sampleLlamaQ4Km().buffer);
		const alphaPath = join(modelsDir, "alpha.gguf");
		saveConfig(configDir, { modelsDir });
		savePresets(presetsFilePath(configDir), {
			version: 2,
			presets: [
				{
					id: "preset-alpha",
					name: "Alpha preset",
					model_path: alphaPath,
					flags: { port: 8123, ctx_size: 2048 },
					env_vars: {},
					created_at: "2026-08-24T00:00:00Z",
					last_used: null,
				},
			],
		});

		const bus = createBus<IntentMap, StateMap>();
		const paths = resolvePaths({
			XDG_CONFIG_HOME: join(scratch, "config"),
			XDG_STATE_HOME: join(scratch, "state"),
		});
		const planSource: { current?: () => LaunchPlan | null } = {};
		const session = createSession({
			paths,
			bus,
			resolveLaunch: () => planSource.current?.() ?? null,
		});
		await session.boot();
		const modelsService = createModelsService(bus, paths);
		modelsService.boot();
		const launches: unknown[] = [];
		bus.onIntent("LAUNCH", (intent) => {
			launches.push(intent);
		});

		const setup = await renderWithAct(
			<SessionApp
				bus={bus}
				paths={paths}
				session={session}
				modelsService={modelsService}
				setPlanSource={(fn) => {
					planSource.current = fn;
				}}
			/>,
			{ width: 120, height: 32 },
		);
		cleanups.push(async () => {
			modelsService.dispose();
			await act(async () => {
				await session.shutdown();
			});
			await teardownWithAct(setup);
			rmSync(scratch, { recursive: true, force: true });
		});

		// Wait for the scan to land, then go to Presets and press L.
		const deadline = Date.now() + 8000;
		for (;;) {
			await act(async () => {
				await setup.flush();
			});
			if (setup.captureCharFrame().includes("alpha.gguf")) break;
			if (Date.now() > deadline)
				throw new Error(`scan never landed:\n${setup.captureCharFrame()}`);
			await new Promise((r) => setTimeout(r, 50));
		}
		await act(async () => {
			await setup.mockInput.pressKeys(["4"]);
		});
		await act(async () => {
			await setup.flush();
		});
		expect(setup.captureCharFrame()).toContain("Alpha preset");
		await act(async () => {
			await setup.mockInput.pressKeys(["L"]);
		});
		await act(async () => {
			await setup.flush();
		});

		expect(launches).toHaveLength(1);
		// The plan resolved AFTER the load (same tick) uses the preset:
		// its model, its port, its ctx_size.
		const plan = planSource.current?.();
		expect(plan).not.toBeNull();
		expect(plan?.port).toBe(8123);
		expect(plan?.args.join(" ")).toContain(alphaPath);
		expect(plan?.args.join(" ")).toContain("2048");
		// The launch stamps last_used on the preset (persisted to disk).
		const stored = loadPresets(presetsFilePath(configDir));
		expect(stored.data?.presets[0]?.last_used).not.toBeNull();
		// And the shell landed on Launch Config.
		expect(setup.captureCharFrame()).toContain("Launch config");
	});

	it("rename from the modal persists through the preset store", async () => {
		mkdirSync(TMP_BASE, { recursive: true });
		const scratch = mkdtempSync(join(TMP_BASE, "rename-"));
		const configDir = join(scratch, "config", "llama-deck");
		const modelsDir = join(scratch, "models");
		mkdirSync(configDir, { recursive: true });
		mkdirSync(modelsDir, { recursive: true });
		writeFixture(modelsDir, "alpha.gguf", sampleLlamaQ4Km().buffer);
		saveConfig(configDir, { modelsDir });
		savePresets(presetsFilePath(configDir), {
			version: 2,
			presets: [
				{
					id: "preset-alpha",
					name: "Alpha preset",
					model_path: join(modelsDir, "alpha.gguf"),
					flags: {},
					env_vars: {},
					created_at: "2026-08-24T00:00:00Z",
					last_used: null,
				},
			],
		});
		const bus = createBus<IntentMap, StateMap>();
		const paths = resolvePaths({
			XDG_CONFIG_HOME: join(scratch, "config"),
			XDG_STATE_HOME: join(scratch, "state"),
		});
		const planSource: { current?: () => LaunchPlan | null } = {};
		const session = createSession({
			paths,
			bus,
			resolveLaunch: () => planSource.current?.() ?? null,
		});
		await session.boot();
		const modelsService = createModelsService(bus, paths);
		modelsService.boot();
		const setup = await renderWithAct(
			<SessionApp
				bus={bus}
				paths={paths}
				session={session}
				modelsService={modelsService}
				setPlanSource={(fn) => {
					planSource.current = fn;
				}}
			/>,
			{ width: 120, height: 32 },
		);
		cleanups.push(async () => {
			modelsService.dispose();
			await act(async () => {
				await session.shutdown();
			});
			await teardownWithAct(setup);
			rmSync(scratch, { recursive: true, force: true });
		});
		await act(async () => {
			await setup.mockInput.pressKeys(["4"]);
		});
		await act(async () => {
			await setup.flush();
		});
		await act(async () => {
			await setup.mockInput.pressKeys(["n"]);
		});
		await act(async () => {
			await setup.flush();
		});
		expect(setup.captureCharFrame()).toContain("Rename preset");
		await act(async () => {
			await setup.mockInput.pressKeys([" ", "2"]);
		});
		await act(async () => {
			await setup.flush();
		});
		await act(async () => {
			await setup.mockInput.pressKeys(["\r"]);
		});
		await act(async () => {
			await setup.flush();
		});
		const stored = loadPresets(presetsFilePath(configDir));
		expect(stored.data?.presets[0]?.name).toBe("Alpha preset 2");
		expect(setup.captureCharFrame()).toContain("Alpha preset 2");
	});
});
