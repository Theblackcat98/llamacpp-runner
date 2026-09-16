import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { type Preset, savePresets } from "../src/core/store/presets";

const TEST_DIR = resolve(".tmp/cli-portability-test");
const configDir = `${TEST_DIR}/config`;
const deckConfigDir = `${configDir}/llama-deck`;
const stateDir = `${TEST_DIR}/state`;
const STORE = `${deckConfigDir}/presets.json`;

const PRESET: Preset = {
	id: "preset-rt",
	name: "roundtrip-model",
	model_path: "~/models/llm/qwen25-7b-q4km.gguf",
	flags: { ctx_size: 8192, n_gpu_layers: 29 },
	env_vars: {},
	created_at: "2026-09-15T10:00:00.000Z",
	last_used: null,
};

function cli(args: string[]) {
	return Bun.spawnSync([process.execPath, "src/cli.ts", ...args], {
		env: {
			...process.env,
			XDG_CONFIG_HOME: configDir,
			XDG_STATE_HOME: stateDir,
		},
	});
}

describe("CLI preset export/import portability (#11)", () => {
	const exportedPath = `${TEST_DIR}/shared-preset.json`;

	beforeAll(() => {
		mkdirSync(deckConfigDir, { recursive: true });
		mkdirSync(stateDir, { recursive: true });
	});

	afterAll(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	it("round-trips export -> wipe -> import -> re-export byte-identical", () => {
		savePresets(STORE, {
			version: 2,
			$schema: "./schema.preset.json",
			presets: [PRESET],
		});

		const first = cli(["export", "roundtrip-model", "--format", "json"]);
		expect(first.exitCode).toBe(0);
		const original = first.stdout.toString();
		const parsed = JSON.parse(original);
		expect(parsed.version).toBe(2);
		expect(parsed.presets).toHaveLength(1);
		expect(parsed.presets[0].id).toBe("preset-rt");
		writeFileSync(exportedPath, original);

		rmSync(STORE);
		const imported = cli(["import", exportedPath]);
		expect(imported.exitCode).toBe(0);
		const importOut = imported.stdout.toString();
		expect(importOut).toContain("roundtrip-model");
		expect(importOut).toContain("preset-rt");

		const second = cli(["export", "preset-rt", "--format", "json"]);
		expect(second.exitCode).toBe(0);
		expect(second.stdout.toString()).toBe(original);
	});

	it("suffixes the id on collision and reports it", () => {
		const imported = cli(["import", exportedPath]);
		expect(imported.exitCode).toBe(0);
		expect(imported.stdout.toString()).toContain("preset-rt-2");

		const store = JSON.parse(readFileSync(STORE, "utf8"));
		expect(store.presets).toHaveLength(2);
		expect(store.presets.map((p: { id: string }) => p.id)).toEqual([
			"preset-rt",
			"preset-rt-2",
		]);
	});

	it("rejects invalid JSON with a clear error and no store mutation", () => {
		const before = readFileSync(STORE, "utf8");
		const bad = `${TEST_DIR}/bad.json`;
		writeFileSync(bad, '{"version": 2, "presets": [');

		const imported = cli(["import", bad]);
		expect(imported.exitCode).not.toBe(0);
		expect(imported.stderr.toString()).toMatch(/json/i);
		expect(readFileSync(STORE, "utf8")).toBe(before);
	});

	it("rejects foreign JSON objects and mutates nothing", () => {
		const before = readFileSync(STORE, "utf8");
		const foreign = `${TEST_DIR}/foreign.json`;
		writeFileSync(foreign, '{"hello": "world"}');

		const imported = cli(["import", foreign]);
		expect(imported.exitCode).not.toBe(0);
		expect(readFileSync(STORE, "utf8")).toBe(before);
	});

	it("rejects future preset versions (D1 forward-only) and mutates nothing", () => {
		const before = readFileSync(STORE, "utf8");
		const future = `${TEST_DIR}/future.json`;
		writeFileSync(
			future,
			JSON.stringify({
				version: 3,
				presets: [PRESET],
			}),
		);

		const imported = cli(["import", future]);
		expect(imported.exitCode).not.toBe(0);
		expect(imported.stderr.toString()).toMatch(/version/i);
		expect(readFileSync(STORE, "utf8")).toBe(before);
	});

	it("export --format json does not require a binary probe", () => {
		// No config/binary configured at all — json export must still work.
		rmSync(STORE, { force: true });
		savePresets(STORE, {
			version: 2,
			$schema: "./schema.preset.json",
			presets: [{ ...PRESET, id: "preset-nobin", name: "nobin" }],
		});
		const out = cli(["export", "nobin", "--format", "json"]);
		expect(out.exitCode).toBe(0);
		expect(JSON.parse(out.stdout.toString()).presets[0].id).toBe(
			"preset-nobin",
		);
		expect(existsSync(STORE)).toBe(true);
	});
});
