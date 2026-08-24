import { describe, expect, it } from "bun:test";
import type { Preset, PresetFile } from "../../src/core/store/presets";
import {
	buildRows,
	clonePreset,
	deletePreset,
	loadIntoConfigurator,
	markLastUsed,
	type PresetRow,
	relink,
	setDefault,
} from "../../src/ui/logic/presets-state";

function preset(overrides: Partial<Preset> = {}): Preset {
	return {
		id: "p1",
		name: "Qwen 32B",
		model_path: "~/models/qwen.gguf",
		flags: { ctx_size: 32768 },
		env_vars: {},
		created_at: "2026-08-24T00:00:00Z",
		last_used: null,
		...overrides,
	};
}

const FILE: PresetFile = {
	version: 2,
	presets: [
		preset(),
		preset({ id: "p2", name: "Llama 8B", model_path: "~/models/gone.gguf" }),
	],
};

/** P4-FR-18..19: presets list logic incl. broken-preset detection. */
describe("buildRows", () => {
	const paths = new Set(["~/models/qwen.gguf"]);

	it("marks presets whose model file is missing as broken (§7)", () => {
		const rows: PresetRow[] = buildRows(FILE.presets, paths);
		expect(rows[0]?.status).toBe("ok");
		expect(rows[1]?.status).toBe("broken");
	});

	it("surfaces unknown flags per row (P4-FR-15 UI flagging)", () => {
		const rows = buildRows(
			[preset({ flags: { ctx_size: 1, future_flag: true } })],
			new Set(["~/models/qwen.gguf"]),
		);
		expect(rows[0]?.unknownFlags).toEqual(["future_flag"]);
	});
});

describe("preset CRUD (P4-FR-19)", () => {
	it("clone copies flags and mints a fresh id/timestamps", () => {
		const next = clonePreset(FILE, "p1");
		expect(next.presets.length).toBe(3);
		const clone = next.presets[2];
		if (!clone) throw new Error("clone missing");
		expect(clone.id).not.toBe("p1");
		expect(clone.flags).toEqual({ ctx_size: 32768 });
		expect(clone.last_used).toBeNull();
	});

	it("delete removes by id", () => {
		const next = deletePreset(FILE, "p1");
		expect(next.presets.map((p) => p.id)).toEqual(["p2"]);
	});

	it("set-default records lastSession pointing at the preset", () => {
		const next = setDefault(FILE, "p2", 1);
		expect(next.lastSession).toEqual({ preset_id: "p2", tab: 1 });
	});

	it("markLastUsed stamps last_used without mutating input", () => {
		const next = markLastUsed(FILE, "p2", "2026-08-24T12:00:00Z");
		const target = next.presets.find((p) => p.id === "p2");
		expect(target?.last_used).toBe("2026-08-24T12:00:00Z");
		expect(FILE.presets.find((p) => p.id === "p2")?.last_used).toBeNull();
	});
});

describe("re-link (P4-FR-18)", () => {
	it("loadIntoConfigurator returns launch inputs for a healthy preset", () => {
		const first = FILE.presets[0];
		if (!first) throw new Error("preset missing");
		const result = loadIntoConfigurator(first);
		expect(result.modelPath).toBe("~/models/qwen.gguf");
		expect(result.values.ctx_size).toBe(32768);
	});

	it("relink swaps the model path of a broken preset", () => {
		const broken = FILE.presets[1] as Preset | undefined;
		if (!broken) throw new Error("missing");
		const next = relink(broken, "~/models/new.gguf");
		expect(next.model_path).toBe("~/models/new.gguf");
	});
});
