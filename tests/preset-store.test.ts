import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { migrate } from "../src/core/store/migrations";
import {
	loadPresets,
	type PresetFile,
	presetsFilePath,
	savePresets,
	splitFlags,
} from "../src/core/store/presets";

const SCRATCH = join(import.meta.dir, "..", ".scratch-preset-store");

beforeAll(() => {
	rmSync(SCRATCH, { recursive: true, force: true });
	mkdirSync(SCRATCH, { recursive: true });
});
afterAll(() => {
	rmSync(SCRATCH, { recursive: true, force: true });
});

function scratchFile(name: string): string {
	return join(SCRATCH, name);
}

const V1_DOC = {
	theme: "tokyonight",
	default_model_dir: "~/models/llm",
	presets: [
		{
			id: "old-one",
			name: "Old Preset",
			model_path: "~/models/llm/old.gguf",
			flags: { ctx_size: 4096 },
		},
	],
};

describe("preset store (P4-FR-13)", () => {
	it("missing file -> empty v2 doc", () => {
		const loaded = loadPresets(scratchFile("absent.json"));
		expect(loaded.data).not.toBeNull();
		expect(loaded.data?.version).toBe(2);
		expect(loaded.data?.presets).toEqual([]);
	});

	it("round-trips a v2 document with lastSession and timestamps", () => {
		const path = scratchFile("round-trip.json");
		const doc: PresetFile = {
			version: 2,
			$schema: "./schema.preset.json",
			default_model_dir: "~/models/llm",
			theme: "tokyonight",
			lastSession: { preset_id: "p1", tab: 1 },
			presets: [
				{
					id: "p1",
					name: "Qwen 32B Full Offload",
					model_path: "~/models/llm/qwen.gguf",
					flags: { n_gpu_layers: 65, ctx_size: 32768, host: "127.0.0.1" },
					env_vars: { CUDA_VISIBLE_DEVICES: "0" },
					created_at: "2026-08-23T10:00:00Z",
					last_used: null,
				},
			],
		};
		savePresets(path, doc);
		const loaded = loadPresets(path);
		expect(loaded.data).toEqual(doc);
	});

	it("hand-editable JSON on disk matches schema v2 shape (§5)", () => {
		const path = scratchFile("shape.json");
		savePresets(path, {
			version: 2,
			presets: [
				{
					id: "x",
					name: "X",
					model_path: "~/m.gguf",
					flags: {},
					env_vars: {},
					created_at: "2026-08-24T00:00:00Z",
					last_used: null,
				},
			],
		});
		const raw = JSON.parse(readFileSync(path, "utf8")) as Record<
			string,
			unknown
		>;
		expect(raw.version).toBe(2);
		expect(raw.$schema).toBe("./schema.preset.json");
	});
});

describe("migrations (P4-FR-14)", () => {
	it("v1 -> v2 forward migration adds version/schema and normalizes presets", () => {
		const migrated = migrate(V1_DOC as Record<string, unknown>) as Record<
			string,
			unknown
		>;
		expect(migrated.version).toBe(2);
		expect(migrated.$schema).toBe("./schema.preset.json");
		const presets = migrated.presets as Record<string, unknown>[] | undefined;
		const preset = presets?.[0];
		if (!preset) throw new Error("preset missing");
		expect(preset.created_at).toBeTypeOf("string");
		expect(preset.env_vars).toEqual({});
		expect(preset.last_used).toBeNull();
		expect(preset.flags).toEqual({ ctx_size: 4096 });
	});

	it("already-v2 documents pass through untouched", () => {
		const doc: PresetFile = { version: 2, presets: [] };
		expect(migrate(doc)).toEqual({ ...doc, $schema: "./schema.preset.json" });
	});

	it("migration writes .bak of the previous file (P4-FR-14)", () => {
		const path = scratchFile("bak.json");
		writeFileSync(path, JSON.stringify(V1_DOC));
		const { data } = loadPresets(path);
		if (!data) throw new Error("no data");
		savePresets(path, data, { migratedFrom: 1 });
		expect(existsSync(`${path}.bak`)).toBe(true);
		const bak = JSON.parse(readFileSync(`${path}.bak`, "utf8"));
		expect(bak.version).toBeUndefined();
	});
});

describe("atomic writes (P4-NFR-02)", () => {
	it("injected rename failure leaves the original file intact", () => {
		const path = scratchFile("crash.json");
		const original = { version: 2, presets: [], theme: "tokyonight" };
		savePresets(path, original);

		expect(() =>
			savePresets(
				path,
				{ version: 2, presets: [] },
				{
					renameFn: () => {
						throw new Error("ENOSPC mid-rename");
					},
				},
			),
		).toThrow();

		const onDisk = JSON.parse(readFileSync(path, "utf8"));
		expect(onDisk.theme).toBe("tokyonight");
		expect(onDisk.version).toBe(2);
		// No stray temp files left behind beyond the failed one is acceptable;
		// the invariant is: original never truncated.
		for (const f of readdirSync(SCRATCH)) {
			if (f.startsWith("crash.json") && f !== "crash.json") {
				expect(f.endsWith(".tmp")).toBe(true);
			}
		}
	});
});

describe("unknown flags (P4-FR-15)", () => {
	it("unknown flags survive save/load verbatim", () => {
		const path = scratchFile("unknown.json");
		const doc: PresetFile = {
			version: 2,
			presets: [
				{
					id: "u",
					name: "U",
					model_path: "~/m.gguf",
					flags: {
						ctx_size: 2048,
						some_future_flag: true,
						another_unknown: "kept",
					},
					env_vars: {},
					created_at: "2026-08-24T00:00:00Z",
					last_used: null,
				},
			],
		};
		savePresets(path, doc);
		const loaded = loadPresets(path);
		const flags = loaded.data?.presets[0]?.flags;
		expect(flags?.some_future_flag).toBe(true);
		expect(flags?.another_unknown).toBe("kept");
		expect(flags?.ctx_size).toBe(2048);
	});

	it("splitFlags separates known registry ids from unknown ones (UI flagging)", () => {
		const { known, unknown } = splitFlags({
			ctx_size: 2048,
			future_thing: 1,
		});
		expect(known).toEqual({ ctx_size: 2048 });
		expect(Object.keys(unknown)).toEqual(["future_thing"]);
	});
});

it("presetsFilePath joins config dir", () => {
	expect(presetsFilePath("/cfg")).toBe(join("/cfg", "presets.json"));
});
