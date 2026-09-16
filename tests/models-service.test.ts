import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createBus } from "../src/core/bus";
import type { IntentMap, StateMap } from "../src/core/bus-contract";
import { createModelsService } from "../src/core/models/service";
import { saveConfig } from "../src/core/store/config";
import { sampleLlamaQ4Km } from "./fixtures/gguf/build";

const DIRS: string[] = [];

afterEach(() => {
	for (const dir of DIRS.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function scratch(label: string): string {
	const dir = join(tmpdir(), `svc-${label}-${Date.now()}-${Math.random()}`);
	mkdirSync(dir, { recursive: true });
	DIRS.push(dir);
	return dir;
}

describe("models service over the bus (P3-FR-17/19)", () => {
	it("boots from persisted config and scans the configured dir", async () => {
		const models = scratch("models");
		const state = scratch("state");
		const config = scratch("config");
		writeFileSync(join(models, "m.gguf"), sampleLlamaQ4Km().buffer);
		saveConfig(config, { modelsDir: models });

		const bus = createBus<IntentMap, StateMap>();
		let dirEvent: string | null | undefined;
		let lastEntries: number | undefined;
		bus.onState("MODELS_DIR", (e) => {
			dirEvent = e.dir;
		});
		bus.onState("MODELS_STATE", (e) => {
			if (!e.scanning) lastEntries = e.entries.length;
		});

		const service = createModelsService(bus, {
			stateDir: state,
			configDir: config,
			pidFile: join(state, "server.pid"),
		});
		service.boot();

		await new Promise((r) => setTimeout(r, 300));
		expect(dirEvent).toBe(models);
		expect(lastEntries).toBe(1);
		service.dispose();
	});

	it("RESCAN intent triggers a fresh scan", async () => {
		const models = scratch("rescan-models");
		const state = scratch("rescan-state");
		const config = scratch("rescan-config");
		writeFileSync(join(models, "a.gguf"), sampleLlamaQ4Km().buffer);
		saveConfig(config, { modelsDir: models });

		const bus = createBus<IntentMap, StateMap>();
		let scans = 0;
		bus.onState("MODELS_STATE", (e) => {
			if (!e.scanning) scans++;
		});
		const service = createModelsService(bus, {
			stateDir: state,
			configDir: config,
			pidFile: "",
		});
		service.boot();
		await new Promise((r) => setTimeout(r, 300));
		const afterBoot = scans;

		writeFileSync(join(models, "b.gguf"), sampleLlamaQ4Km().buffer);
		bus.emitIntent("RESCAN", {});
		await new Promise((r) => setTimeout(r, 400));

		expect(scans).toBeGreaterThan(afterBoot);
		service.dispose();
	});
});

describe("lossless invalidation (#17)", () => {
	it("a change arriving during a scan schedules exactly one follow-up scan", async () => {
		const seed = seedPaths("change-during-scan");
		// Several models widen the first scan's walk window.
		for (let i = 0; i < 30; i++) {
			writeFileSync(
				join(seed.modelsDir, `m${i}.gguf`),
				sampleLlamaQ4Km().buffer,
			);
		}
		writeFileSync(
			join(seed.configDir, "config.json"),
			JSON.stringify({ modelsDir: seed.modelsDir }),
		);

		const bus = createBus<IntentMap, StateMap>();
		const completions: number[] = [];
		let nudged = false;
		bus.onState("MODELS_STATE", (e) => {
			if (e.scanning && !nudged) {
				// The first scan is now in flight. Defer to a macrotask so the
				// boot path has finished wiring the watcher, then drop a new
				// model into a NESTED directory mid-scan.
				nudged = true;
				setTimeout(() => {
					mkdirSync(join(seed.modelsDir, "late"), { recursive: true });
					writeFileSync(
						join(seed.modelsDir, "late", "b.gguf"),
						sampleLlamaQ4Km().buffer,
					);
				}, 0);
			}
			if (!e.scanning) completions.push(e.entries.length);
		});

		const svc = createModelsService(bus, seed);
		svc.boot();
		await waitFor(() => (completions.length >= 2 ? completions : null));
		await new Promise((r) => setTimeout(r, 1200));

		// The mid-scan change is never lost: a second scan includes it...
		expect(completions[completions.length - 1]).toBe(31);
		// ...and after quiescence exactly one follow-up happened (no loops).
		expect(completions).toHaveLength(2);
		svc.dispose();
	}, 20_000);

	it("nested-directory changes trigger a rescan without manual refresh", async () => {
		const seed = seedPaths("nested-watch");
		writeFileSync(join(seed.modelsDir, "a.gguf"), sampleLlamaQ4Km().buffer);
		writeFileSync(
			join(seed.configDir, "config.json"),
			JSON.stringify({ modelsDir: seed.modelsDir }),
		);

		const bus = createBus<IntentMap, StateMap>();
		let lastEntries = 0;
		let scans = 0;
		bus.onState("MODELS_STATE", (e) => {
			if (!e.scanning) {
				lastEntries = e.entries.length;
				scans++;
			}
		});

		const svc = createModelsService(bus, seed);
		svc.boot();
		await new Promise((r) => setTimeout(r, 400));
		const bootScans = scans;

		mkdirSync(join(seed.modelsDir, "family"), { recursive: true });
		writeFileSync(
			join(seed.modelsDir, "family", "nested.gguf"),
			sampleLlamaQ4Km().buffer,
		);

		await waitFor(() => (lastEntries === 2 ? lastEntries : null));
		expect(scans).toBeGreaterThan(bootScans);
		svc.dispose();
	}, 20_000);
});

function waitFor<T>(
	fn: () => T | null | undefined,
	timeoutMs = 8000,
): Promise<T> {
	return new Promise((resolve, reject) => {
		const started = Date.now();
		const tick = (): void => {
			const v = fn();
			if (v != null) {
				resolve(v);
				return;
			}
			if (Date.now() - started > timeoutMs) {
				reject(new Error("waitFor timeout"));
				return;
			}
			setTimeout(tick, 50);
		};
		tick();
	});
}

import { fileURLToPath } from "node:url";

const SEED_TMP = fileURLToPath(
	new URL("./.tmp/models-service/", import.meta.url),
);

function seedPaths(tag: string) {
	const stateDir = join(SEED_TMP, tag, "state");
	const configDir = join(SEED_TMP, tag, "config");
	const modelsDir = join(SEED_TMP, tag, "models");
	mkdirSync(stateDir, { recursive: true });
	mkdirSync(configDir, { recursive: true });
	mkdirSync(modelsDir, { recursive: true });
	return {
		stateDir,
		configDir,
		pidFile: join(stateDir, "server.pid"),
		modelsDir,
	};
}

afterAll(() => {
	rmSync(SEED_TMP, { recursive: true, force: true });
});

describe("models service first-run seeding (F10, §7)", () => {
	it("seeds modelsDir from presets default_model_dir when config is empty", () => {
		const paths = seedPaths("seed");
		writeFileSync(
			join(paths.configDir, "presets.json"),
			JSON.stringify({
				version: 2,
				presets: [],
				default_model_dir: paths.modelsDir,
			}),
		);
		const bus = createBus<IntentMap, StateMap>();
		const dirs: (string | null)[] = [];
		bus.onState("MODELS_DIR", (e) => dirs.push(e.dir));
		const svc = createModelsService(bus, paths);
		svc.boot();
		expect(dirs).toEqual([paths.modelsDir]);
		const saved = JSON.parse(
			readFileSync(join(paths.configDir, "config.json"), "utf8"),
		) as { modelsDir?: string };
		expect(saved.modelsDir).toBe(paths.modelsDir);
		svc.dispose();
	});

	it("config modelsDir wins over presets default_model_dir", () => {
		const paths = seedPaths("explicit");
		const other = join(SEED_TMP, "explicit", "other-models");
		mkdirSync(other, { recursive: true });
		writeFileSync(
			join(paths.configDir, "config.json"),
			JSON.stringify({ modelsDir: paths.modelsDir }),
		);
		writeFileSync(
			join(paths.configDir, "presets.json"),
			JSON.stringify({
				version: 2,
				presets: [],
				default_model_dir: other,
			}),
		);
		const bus = createBus<IntentMap, StateMap>();
		const dirs: (string | null)[] = [];
		bus.onState("MODELS_DIR", (e) => dirs.push(e.dir));
		const svc = createModelsService(bus, paths);
		svc.boot();
		expect(dirs).toEqual([paths.modelsDir]);
		svc.dispose();
	});

	it("ignores a default_model_dir that does not exist", () => {
		const paths = seedPaths("missing");
		writeFileSync(
			join(paths.configDir, "presets.json"),
			JSON.stringify({
				version: 2,
				presets: [],
				default_model_dir: join(SEED_TMP, "missing", "nope"),
			}),
		);
		const bus = createBus<IntentMap, StateMap>();
		const dirs: (string | null)[] = [];
		bus.onState("MODELS_DIR", (e) => dirs.push(e.dir));
		const svc = createModelsService(bus, paths);
		svc.boot();
		expect(dirs).toEqual([null]);
		svc.dispose();
	});

	it("expands ~ in SET_MODELS_DIR intent before saving and scanning (Issue #28)", async () => {
		const paths = seedPaths("tilde-intent");
		const bus = createBus<IntentMap, StateMap>();
		const dirs: (string | null)[] = [];
		bus.onState("MODELS_DIR", (e) => dirs.push(e.dir));
		const svc = createModelsService(bus, paths);
		svc.boot();

		bus.emitIntent("SET_MODELS_DIR", { dir: "~/models/llm" });
		await new Promise((r) => setTimeout(r, 50));

		const expected = join(homedir(), "models/llm");
		expect(dirs).toContain(expected);

		const saved = JSON.parse(
			readFileSync(join(paths.configDir, "config.json"), "utf8"),
		) as { modelsDir?: string };
		expect(saved.modelsDir).toBe(expected);
		svc.dispose();
	});

	it("surfaces scanner walk errors in MODELS_STATE event (Issue #27)", async () => {
		const paths = seedPaths("scanner-errors");
		const invalidDir = join(paths.modelsDir, "does-not-exist");
		writeFileSync(
			join(paths.configDir, "config.json"),
			JSON.stringify({ modelsDir: invalidDir }),
		);
		const bus = createBus<IntentMap, StateMap>();
		let lastError: string | undefined;
		let receivedScanningFalse = false;
		bus.onState("MODELS_STATE", (e) => {
			if (!e.scanning) {
				receivedScanningFalse = true;
				lastError = e.error;
			}
		});
		const svc = createModelsService(bus, paths);
		svc.boot();

		await new Promise((r) => setTimeout(r, 200));
		expect(receivedScanningFalse).toBe(true);
		expect(lastError).toBeDefined();
		expect(lastError).toContain(invalidDir);
		svc.dispose();
	});
});
