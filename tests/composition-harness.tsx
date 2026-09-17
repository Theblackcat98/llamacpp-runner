/**
 * Reusable composition-root harness (Issue #31).
 *
 * Boots the REAL SessionApp composition — session.boot() → modelsService
 * boot → bus subscriptions → screens — against a temp XDG home with
 * synthetic .gguf fixtures. No hand-fed props: state flows through the
 * same bus/intent wiring production uses.
 *
 * Future flow tests (palette, presets round-trip, configurator edits)
 * should build on `bootCompositionApp` rather than re-wiring the
 * composition root by hand.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { createBus } from "../src/core/bus";
import type { IntentMap, StateMap } from "../src/core/bus-contract";
import { createModelsService } from "../src/core/models/service";
import { createSession, type LaunchPlan } from "../src/core/session";
import { saveConfig } from "../src/core/store/config";
import { presetsFilePath, savePresets } from "../src/core/store/presets";
import { resolvePaths } from "../src/core/store/state-paths";
import { SessionApp } from "../src/main";
import { sampleLlamaQ4Km, writeFixture } from "./fixtures/gguf/build";
import { renderWithAct, teardownWithAct } from "./ui/golden/harness";

const PROJECT_ROOT = join(import.meta.dir, "..");
const TMP_BASE = join(PROJECT_ROOT, ".tmp");

export interface CompositionApp {
	scratch: string;
	modelsDir: string;
	bus: ReturnType<typeof createBus<IntentMap, StateMap>>;
	session: ReturnType<typeof createSession>;
	modelsService: ReturnType<typeof createModelsService>;
	/** Live launch-plan resolver, wired exactly like production. */
	planSource: { current?: () => LaunchPlan | null };
	setup: Awaited<ReturnType<typeof testRender>>;
	/** Current character frame. */
	frame: () => string;
	/** Drive keys through the harness, then flush. */
	press: (keys: string[]) => Promise<void>;
	dispose: () => Promise<void>;
}

export interface BootOptions {
	/** .gguf fixture filenames to create in the models dir. */
	fixtureNames?: string[];
	/** Persist modelsDir in config (false → boots into the WELCOME panel). */
	configureDir?: boolean;
	/** #59: seed a truncated presets.json to exercise the corrupt path. */
	corruptPresets?: boolean;
	width?: number;
	height?: number;
	configuredBinary?: string;
}

export async function bootCompositionApp(
	opts: BootOptions = {},
): Promise<CompositionApp> {
	const {
		fixtureNames = ["alpha.gguf", "beta.gguf"],
		configureDir = true,
		width = 120,
		height = 30,
	} = opts;

	mkdirSync(TMP_BASE, { recursive: true });
	const scratch = mkdtempSync(join(TMP_BASE, "comp-e2e-"));
	const configDir = join(scratch, "config", "llama-deck");
	const modelsDir = join(scratch, "models");
	mkdirSync(configDir, { recursive: true });
	mkdirSync(modelsDir, { recursive: true });
	for (const name of fixtureNames) {
		writeFixture(modelsDir, name, sampleLlamaQ4Km().buffer);
	}
	saveConfig(configDir, configureDir ? { modelsDir } : {});
	if (opts.corruptPresets) {
		// Simulate an interrupted write: valid filename, truncated JSON.
		writeFileSync(presetsFilePath(configDir), '{"version":2,"presets":[{"');
	}
	if (opts.configuredBinary !== undefined) {
		savePresets(presetsFilePath(configDir), {
			version: 2,
			presets: [],
			binary_path: opts.configuredBinary,
		});
	}

	const bus = createBus<IntentMap, StateMap>();
	const paths = resolvePaths({
		XDG_CONFIG_HOME: join(scratch, "config"),
		XDG_STATE_HOME: join(scratch, "state"),
	});

	const planSource: CompositionApp["planSource"] = {};
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
		{ width, height },
	);

	const app: CompositionApp = {
		scratch,
		modelsDir,
		bus,
		session,
		modelsService,
		planSource,
		setup,
		frame: () => setup.captureCharFrame(),
		press: async (keys: string[]) => {
			await act(async () => {
				await setup.mockInput.pressKeys(keys);
			});
			await act(async () => {
				await setup.flush();
			});
		},
		dispose: async () => {
			modelsService.dispose();
			await act(async () => {
				await session.shutdown();
			});
			await teardownWithAct(setup);
			rmSync(scratch, { recursive: true, force: true });
		},
	};
	return app;
}

/**
 * Poll the frame until `predicate` holds (scan + React settle are async).
 * Throws with the last frame on timeout — a loud failure, never a sleep.
 */
export async function waitForFrame(
	app: CompositionApp,
	predicate: (frame: string) => boolean,
	timeoutMs = 8000,
): Promise<string> {
	const start = Date.now();
	for (;;) {
		await act(async () => {
			await app.setup.flush();
		});
		const frame = app.frame();
		if (predicate(frame)) return frame;
		if (Date.now() - start > timeoutMs) {
			throw new Error(
				`timed out waiting for frame condition. Last frame:\n${frame}`,
			);
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}
