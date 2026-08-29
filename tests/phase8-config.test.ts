import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { presetToPlan } from "../src/core/preset-launch";
import { loadConfig } from "../src/core/store/config";
import { loadPresets } from "../src/core/store/presets";

const PRESET = {
	id: "p1",
	name: "Test",
	model_path: "model.gguf",
	flags: {},
	env_vars: {},
	created_at: "2026-01-01T00:00:00Z",
	last_used: null,
};

describe("Phase 8 persistence safety", () => {
	it("rejects malformed config shapes instead of accepting arbitrary JSON", () => {
		const path = join(import.meta.dir, "..", ".tmp", "phase8-bad-config");
		Bun.write(
			join(path, "config.json"),
			`${JSON.stringify({ modelsDir: 42 }, null, "\t")}\n`,
		);
		expect(loadConfig(path)).toEqual({});
	});

	it("rejects malformed preset documents safely", () => {
		const path = join(import.meta.dir, "..", ".tmp", "phase8-bad-presets.json");
		Bun.write(
			path,
			`${JSON.stringify({ version: 2, presets: [{ id: 4 }] }, null, "\t")}\n`,
		);
		expect(loadPresets(path).data?.presets).toEqual([]);
	});

	it("reports the original version before migration", () => {
		const path = join(import.meta.dir, "..", ".tmp", "phase8-v1.json");
		Bun.write(path, `${JSON.stringify({ presets: [] }, null, "\t")}\n`);
		expect(loadPresets(path).migratedFrom).toBe(1);
	});
});

describe("Phase 8 launch resolution", () => {
	it("uses the preset binary_path and expands relative model paths", () => {
		const plan = presetToPlan({
			...PRESET,
			model_path: "./models/model.gguf",
			binary_path: "./bin/llama-server",
		} as typeof PRESET & { binary_path: string });
		expect(plan.command).toBe(join(process.cwd(), "bin/llama-server"));
		expect(plan.args).toContain(join(process.cwd(), "models/model.gguf"));
	});
});
