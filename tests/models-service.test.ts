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
});
