import { describe, expect, it } from "bun:test";
import {
	exportPresetDoc,
	importPresetsInto,
	parsePresetDoc,
} from "../src/core/store/preset-portability";
import type { Preset, PresetFile } from "../src/core/store/presets";

const BASE: Preset = {
	id: "preset-123",
	name: "my-model",
	model_path: "~/models/llm/qwen25-7b-q4km.gguf",
	flags: { ctx_size: 8192, flash_attn: true, n_gpu_layers: 29 },
	env_vars: { LLAMA_CACHE: "/tmp/kv" },
	created_at: "2026-09-15T10:00:00.000Z",
	last_used: null,
};

function storeWith(...presets: Preset[]): PresetFile {
	return { version: 2, $schema: "./schema.preset.json", presets };
}

describe("exportPresetDoc (#11)", () => {
	it("wraps a single preset as a self-contained v2 PresetFile", () => {
		const doc = exportPresetDoc(BASE);
		expect(doc.version).toBe(2);
		expect(doc.presets).toHaveLength(1);
		expect(doc.presets[0]).toEqual(BASE);
	});

	it("export output survives parse as a valid preset document", () => {
		const raw = JSON.stringify(exportPresetDoc(BASE), null, "\t");
		const parsed = parsePresetDoc(raw);
		expect(parsed.ok).toBe(true);
		if (parsed.ok) {
			expect(parsed.doc.presets[0]).toEqual(BASE);
		}
	});
});

describe("parsePresetDoc (#11)", () => {
	it("rejects non-JSON content with a clear error", () => {
		const parsed = parsePresetDoc("llama-server -m model.gguf -c 4096");
		expect(parsed.ok).toBe(false);
		if (!parsed.ok) expect(parsed.error).toMatch(/json/i);
	});

	it("rejects malformed JSON with a clear error", () => {
		const parsed = parsePresetDoc('{"version": 2, "presets": [');
		expect(parsed.ok).toBe(false);
		if (!parsed.ok) expect(parsed.error).toMatch(/json/i);
	});

	it("rejects foreign JSON objects (valid JSON, wrong shape)", () => {
		const parsed = parsePresetDoc('{"hello": "world"}');
		expect(parsed.ok).toBe(false);
		if (!parsed.ok) expect(parsed.error).toMatch(/preset/i);
	});

	it("rejects presets missing required fields", () => {
		const parsed = parsePresetDoc(
			JSON.stringify({
				version: 2,
				presets: [{ id: "x", name: "no model path" }],
			}),
		);
		expect(parsed.ok).toBe(false);
	});

	it("rejects unknown future versions (D1 forward-only)", () => {
		const future: PresetFile = { ...storeWith(BASE), version: 3 };
		const parsed = parsePresetDoc(JSON.stringify(future));
		expect(parsed.ok).toBe(false);
		if (!parsed.ok) {
			expect(parsed.error).toMatch(/version/i);
			expect(parsed.error).toMatch(/3/);
		}
	});

	it("accepts and migrates legacy v1 documents", () => {
		const legacy = JSON.stringify({
			version: 1,
			presets: [{ ...BASE, env_vars: undefined, created: BASE.created_at }],
		});
		const parsed = parsePresetDoc(legacy);
		expect(parsed.ok).toBe(true);
		if (parsed.ok) {
			expect(parsed.doc.version).toBe(2);
			expect(parsed.doc.presets[0]?.model_path).toBe(BASE.model_path);
		}
	});
});

describe("importPresetsInto (#11)", () => {
	it("imports into an empty store unchanged", () => {
		const { doc: merged, imported } = importPresetsInto(
			storeWith(),
			exportPresetDoc(BASE),
		);
		expect(merged.presets).toEqual([BASE]);
		expect(imported.every((i) => !i.renamedId)).toBe(true);
	});

	it("preserves existing store presets", () => {
		const other: Preset = { ...BASE, id: "preset-other", name: "other" };
		const { doc: merged } = importPresetsInto(
			storeWith(other),
			exportPresetDoc(BASE),
		);
		expect(merged.presets).toHaveLength(2);
		expect(merged.presets.map((p) => p.id)).toContain("preset-other");
	});

	it("resolves id collisions with a -2 suffix and reports the rename", () => {
		const first = importPresetsInto(storeWith(), exportPresetDoc(BASE));
		const second = importPresetsInto(first.doc, exportPresetDoc(BASE));
		expect(second.doc.presets).toHaveLength(2);
		expect(second.doc.presets[1]?.id).toBe("preset-123-2");
		expect(second.doc.presets[1]?.name).toBe(BASE.name);
		expect(second.imported[0]?.renamedId).toBe(true);
		expect(second.imported[0]?.originalId).toBe("preset-123");
	});

	it("keeps suffixing on repeated imports (-3, -4, ...)", () => {
		let store = storeWith();
		for (let i = 0; i < 3; i++) {
			const next = importPresetsInto(store, exportPresetDoc(BASE));
			store = next.doc;
		}
		expect(store.presets.map((p) => p.id)).toEqual([
			"preset-123",
			"preset-123-2",
			"preset-123-3",
		]);
	});

	it("imports every preset from a multi-preset document", () => {
		const doc = storeWith(BASE, { ...BASE, id: "preset-b", name: "b" });
		const { doc: merged } = importPresetsInto(storeWith(), doc);
		expect(merged.presets).toHaveLength(2);
	});

	it("round-trip: export -> wipe -> import -> re-export is byte-identical", () => {
		const original = `${JSON.stringify(exportPresetDoc(BASE), null, "\t")}\n`;
		const parsed = parsePresetDoc(original);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		const wiped = storeWith();
		const { doc: merged } = importPresetsInto(wiped, parsed.doc);
		const reexported = `${JSON.stringify(exportPresetDoc(merged.presets[0] as Preset), null, "\t")}\n`;
		expect(reexported).toBe(original);
	});
});
