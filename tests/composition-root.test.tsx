import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createBus } from "../src/core/bus";
import type { IntentMap, StateMap } from "../src/core/bus-contract";
import { createModelsService } from "../src/core/models/service";
import { createSession, type LaunchPlan } from "../src/core/session";
import { saveConfig } from "../src/core/store/config";
import { resolvePaths } from "../src/core/store/state-paths";
import { SessionApp } from "../src/main";
import { sampleLlamaQ4Km, writeFixture } from "./fixtures/gguf/build";
import { renderWithAct, teardownWithAct } from "./ui/golden/harness";

const PROJECT_ROOT = join(import.meta.dir, "..");
const TMP_BASE = join(PROJECT_ROOT, ".tmp");

function createScratchDir(): string {
	mkdirSync(TMP_BASE, { recursive: true });
	return mkdtempSync(join(TMP_BASE, "comp-root-"));
}

describe("composition root E2E (Issue #25)", () => {
	let scratch: string;

	afterEach(() => {
		if (scratch) {
			rmSync(scratch, { recursive: true, force: true });
		}
	});

	it("boots with a valid configured dir and renders model table without WELCOME panel", async () => {
		scratch = createScratchDir();
		const configDir = join(scratch, "config", "llama-deck");
		const modelsDir = join(scratch, "models");
		mkdirSync(configDir, { recursive: true });
		mkdirSync(modelsDir, { recursive: true });

		writeFixture(modelsDir, "test-model.gguf", sampleLlamaQ4Km().buffer);
		saveConfig(configDir, { modelsDir });

		const bus = createBus<IntentMap, StateMap>();
		const paths = resolvePaths({
			XDG_CONFIG_HOME: join(scratch, "config"),
			XDG_STATE_HOME: join(scratch, "state"),
		});

		const session = createSession({ paths, bus });
		await session.boot();

		const modelsService = createModelsService(bus, paths, {
			defaultDir: modelsDir,
		});
		modelsService.boot();

		const setup = await renderWithAct(
			<SessionApp
				bus={bus}
				paths={paths}
				session={session}
				modelsService={modelsService}
			/>,
			{ width: 120, height: 30 },
		);

		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 200));
			await setup.flush();
		});

		const frame = setup.captureCharFrame();
		expect(frame).not.toContain("No model directory configured yet");
		expect(frame).toContain("test-model.gguf");

		// Test rescan via intent
		await act(async () => {
			bus.emitIntent("RESCAN", {});
			await new Promise((resolve) => setTimeout(resolve, 150));
			await setup.flush();
		});

		const frameAfterRescan = setup.captureCharFrame();
		expect(frameAfterRescan).not.toContain("No model directory configured yet");
		expect(frameAfterRescan).toContain("test-model.gguf");

		modelsService.dispose();
		await teardownWithAct(setup);
	});

	it("preserves selected model and custom configured values across RESCAN and MODELS_STATE (Issue #29)", async () => {
		scratch = createScratchDir();
		const configDir = join(scratch, "config", "llama-deck");
		const modelsDir = join(scratch, "models");
		mkdirSync(configDir, { recursive: true });
		mkdirSync(modelsDir, { recursive: true });

		writeFixture(modelsDir, "alpha-model.gguf", sampleLlamaQ4Km().buffer);
		writeFixture(modelsDir, "beta-model.gguf", sampleLlamaQ4Km().buffer);
		saveConfig(configDir, { modelsDir });

		const bus = createBus<IntentMap, StateMap>();
		const paths = resolvePaths({
			XDG_CONFIG_HOME: join(scratch, "config"),
			XDG_STATE_HOME: join(scratch, "state"),
		});

		const session = createSession({ paths, bus });
		await session.boot();

		const modelsService = createModelsService(bus, paths, {
			defaultDir: modelsDir,
		});
		modelsService.boot();

		let currentPlanSource: { current?: () => LaunchPlan | null } = {};
		const setup = await renderWithAct(
			<SessionApp
				bus={bus}
				paths={paths}
				session={session}
				modelsService={modelsService}
				setPlanSource={(fn) => {
					currentPlanSource.current = fn;
				}}
			/>,
			{ width: 120, height: 30 },
		);

		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 200));
			await setup.flush();
		});

		// Verify initial auto-selection or plan
		let plan = currentPlanSource.current?.();
		expect(plan).not.toBeNull();
		expect(plan?.command).toBeDefined();

		// Trigger rescan via RESCAN intent
		await act(async () => {
			bus.emitIntent("RESCAN", {});
			await new Promise((resolve) => setTimeout(resolve, 200));
			await setup.flush();
		});

		// Check plan again
		plan = currentPlanSource.current?.();
		expect(plan).not.toBeNull();
		expect(plan?.presetId).toBe("ad-hoc");

		modelsService.dispose();
		await teardownWithAct(setup);
	});
});

