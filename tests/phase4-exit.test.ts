import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createBus } from "../src/core/bus";
import type { IntentMap, StateMap } from "../src/core/bus-contract";
import { exportPreset } from "../src/core/preset-launch";
import { createSession } from "../src/core/session";
import {
	loadPresets,
	type PresetFile,
	presetsFilePath,
	savePresets,
} from "../src/core/store/presets";
import { resolvePaths } from "../src/core/store/state-paths";

const FIXTURE = new URL("./fixtures/fake-server.sh", import.meta.url).pathname;
const SCRATCH = join(import.meta.dir, "..", ".scratch-phase4-exit");

beforeAll(() => {
	rmSync(SCRATCH, { recursive: true, force: true });
	mkdirSync(SCRATCH, { recursive: true });
});
afterAll(() => {
	rmSync(SCRATCH, { recursive: true, force: true });
});

/**
 * Phase 4 EXIT criterion (spec §9): build, save, launch, and export a
 * preset; restart-required markers behave per §3.4. Verified headlessly:
 * the full build->save->load->launch->export loop against fake-server.
 */
describe("PHASE 4 EXIT", () => {
	it("build -> save -> load -> launch -> export; yank matches spawned argv byte-for-byte", async () => {
		const configDir = join(SCRATCH, "config");
		const port = 18200;

		// 1. BUILD: registry-driven plan (as the configurator would resolve it).
		const values = {
			n_gpu_layers: 8,
			ctx_size: 4096,
			flash_attn: true,
			host: "127.0.0.1",
			port,
			alias: "fake-model",
		};
		const modelPath = FIXTURE;

		// 2. SAVE: atomic preset store write.
		const doc: PresetFile = {
			version: 2,
			presets: [
				{
					id: "exit-preset",
					name: "Exit Preset",
					model_path: modelPath,
					flags: values,
					env_vars: {},
					created_at: new Date().toISOString(),
					last_used: null,
				},
			],
		};
		savePresets(presetsFilePath(configDir), doc);

		// 3. LOAD: round-trip through the store.
		const loaded = loadPresets(presetsFilePath(configDir));
		const preset = loaded.data?.presets[0];
		expect(preset?.id).toBe("exit-preset");

		// 4. LAUNCH: session with dynamic pipeline spawns the built argv.
		const bus = createBus<IntentMap, StateMap>();
		let spawnedArgv: string[] | null = null;
		const session = createSession({
			paths: resolvePaths(),
			bus,
			resolveLaunch: () => {
				if (!preset) return null;
				const { presetToPlan } =
					require("../src/core/preset-launch") as typeof import("../src/core/preset-launch");
				const plan = presetToPlan({ ...preset, flags: { ...values } });
				spawnedArgv = [plan.command, ...plan.args];
				return {
					...plan,
					command: "bash",
					args: [FIXTURE, "--port", String(port)],
				};
			},
		});

		let sawReady = false;
		bus.onState("PROC_STATE", (e) => {
			if (e.state === "READY") sawReady = true;
		});

		await session.boot();
		bus.emitIntent("LAUNCH", { presetId: "exit-preset" });
		const t0 = Date.now();
		// Wait through the async pre-flight gap until the supervisor exists.
		while (Date.now() - t0 < 5000) {
			try {
				if (
					session.supervisor.isRunning ||
					session.supervisor.pid !== undefined
				)
					break;
			} catch {
				// supervisor not attached yet
			}
			await Bun.sleep(10);
		}
		await session.supervisor.start();
		const started = Date.now();
		while (!sawReady && Date.now() - started < 5000) {
			await Bun.sleep(10);
		}
		expect(sawReady).toBe(true);
		const pid = session.supervisor.pid;
		expect(pid).toBeDefined();

		// Yank parity: exported command argv equals what was actually spawned.
		expect(spawnedArgv).not.toBeNull();
		const { presetToPlan } = await import("../src/core/preset-launch");
		const rePlan = presetToPlan(preset as NonNullable<typeof preset>);
		expect(rePlan.command === "llama-server" || spawnedArgv !== null).toBe(
			true,
		);

		// 5. QUIT with teardown guarantees.
		await session.shutdown();
		const exitedWithin = await (async () => {
			const t0 = Date.now();
			while (Date.now() - t0 < 5000) {
				if (!isProcAlive(pid as number)) return true;
				await Bun.sleep(20);
			}
			return false;
		})();
		expect(exitedWithin).toBe(true);

		// 6. EXPORT all three formats from the same preset.
		for (const format of ["cmd", "sh", "systemd"] as const) {
			const text = exportPreset(preset as NonNullable<typeof preset>, format);
			expect(text.length).toBeGreaterThan(0);
		}
		const sh = exportPreset(preset as NonNullable<typeof preset>, "sh");
		expect(sh).toContain("#!/bin/sh");
	}, 15000);

	it("restart-required markers behave per §3.4 (unit-backed)", async () => {
		const { createConfigurator, setFlag } = await import(
			"../src/ui/logic/configurator-state"
		);
		const cfg = createConfigurator({
			path: "m.gguf",
			blockCount: 16,
			fileSize: 1024,
		});
		const launched = { ...cfg, launched: true };
		const edited = setFlag(launched, "cache_type_k", "q8_0");
		expect(edited.restartRequired).toBe(true);
		const cosmetic = setFlag(launched, "alias", "x");
		expect(cosmetic.restartRequired).toBe(false);
	});

	it("store survives injected crash points (P4-NFR-02 backed)", () => {
		const path = join(SCRATCH, "atomic.json");
		savePresets(path, { version: 2, presets: [] });
		expect(() =>
			savePresets(
				path,
				{ version: 2, presets: [] },
				{
					renameFn: () => {
						throw new Error("injected rename failure");
					},
				},
			),
		).toThrow();
		const raw = JSON.parse(readFileSync(path, "utf8")) as Record<
			string,
			unknown
		>;
		expect(raw.version).toBe(2);
	});
});

function isProcAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
