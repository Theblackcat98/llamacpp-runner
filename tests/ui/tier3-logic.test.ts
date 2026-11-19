import { describe, expect, it } from "bun:test";
import type { ModelEntry } from "../../src/core/models/types";
import type { PresetFile } from "../../src/core/store/presets";
import {
	trackOffsetForValue,
	valueAtTrackOffset,
} from "../../src/ui/components/slider-state";
import {
	createTableState,
	selectRow,
} from "../../src/ui/components/table-state";
import {
	applyFilterKey,
	cycleSortMode,
	filterEntries,
	sortEntries,
	viewEntries,
} from "../../src/ui/logic/explorer-state";
import { renamePreset } from "../../src/ui/logic/presets-state";

function entry(overrides: Partial<ModelEntry> = {}): ModelEntry {
	return {
		name: "model.gguf",
		path: "/models/model.gguf",
		paths: ["/models/model.gguf"],
		totalBytes: 1000,
		quantName: "Q4_K_M",
		...overrides,
	};
}

const ENTRIES: ModelEntry[] = [
	entry({
		name: "qwen25-7b-q4km.gguf",
		path: "/m/qwen.gguf",
		totalBytes: 4000,
		contextLength: 131072,
	}),
	entry({
		name: "tinyllama-1.1b.gguf",
		path: "/m/tiny.gguf",
		totalBytes: 1000,
		contextLength: 2048,
	}),
	entry({
		name: "llama3-8b-q8.gguf",
		path: "/m/llama.gguf",
		totalBytes: 8000,
		contextLength: 8192,
	}),
	entry({ name: "mystery.gguf", path: "/m/mystery.gguf", totalBytes: 2000 }),
];

describe("explorer filter (Tier 3)", () => {
	it("empty query keeps every entry", () => {
		expect(filterEntries(ENTRIES, "")).toHaveLength(4);
		expect(filterEntries(ENTRIES, "  ")).toHaveLength(4);
	});

	it("substring matches on filename, case-insensitively", () => {
		expect(filterEntries(ENTRIES, "QWEN").map((e) => e.name)).toEqual([
			"qwen25-7b-q4km.gguf",
		]);
		expect(filterEntries(ENTRIES, "llama").map((e) => e.name)).toEqual([
			"tinyllama-1.1b.gguf",
			"llama3-8b-q8.gguf",
		]);
	});

	it("fuzzy subsequence matches scattered characters", () => {
		expect(filterEntries(ENTRIES, "q25").map((e) => e.name)).toEqual([
			"qwen25-7b-q4km.gguf",
		]);
		expect(filterEntries(ENTRIES, "zzz")).toEqual([]);
	});

	it("preserves entry object identity for path-based selection", () => {
		const out = viewEntries(ENTRIES, "llama", "name");
		for (const e of out) expect(ENTRIES).toContain(e);
	});
});

describe("explorer sort (Tier 3)", () => {
	it("cycles name -> size -> context -> name", () => {
		expect(cycleSortMode("name")).toBe("size");
		expect(cycleSortMode("size")).toBe("context");
		expect(cycleSortMode("context")).toBe("name");
	});

	it("sorts by name ascending", () => {
		expect(sortEntries(ENTRIES, "name").map((e) => e.name)).toEqual([
			"llama3-8b-q8.gguf",
			"mystery.gguf",
			"qwen25-7b-q4km.gguf",
			"tinyllama-1.1b.gguf",
		]);
	});

	it("sorts by size descending", () => {
		expect(sortEntries(ENTRIES, "size").map((e) => e.totalBytes)).toEqual([
			8000, 4000, 2000, 1000,
		]);
	});

	it("sorts by context descending with unknown context last", () => {
		expect(sortEntries(ENTRIES, "context").map((e) => e.name)).toEqual([
			"qwen25-7b-q4km.gguf",
			"llama3-8b-q8.gguf",
			"tinyllama-1.1b.gguf",
			"mystery.gguf",
		]);
	});

	it("does not mutate the input array", () => {
		const before = ENTRIES.map((e) => e.name);
		sortEntries(ENTRIES, "size");
		expect(ENTRIES.map((e) => e.name)).toEqual(before);
	});

	it("viewEntries ranks fuzzy matches ahead of sort order", () => {
		// "llama" is a word prefix in llama3 (ranks first) but only an
		// embedded substring in tinyllama.
		expect(viewEntries(ENTRIES, "llama", "name").map((e) => e.name)).toEqual([
			"llama3-8b-q8.gguf",
			"tinyllama-1.1b.gguf",
		]);
	});
});

describe("explorer filter key reducer (Tier 3)", () => {
	it("appends printable characters incl. shifted via sequence", () => {
		expect(applyFilterKey("qw", { name: "e" })?.query).toBe("qwe");
		expect(applyFilterKey("qw", { name: "t", sequence: "T" })?.query).toBe(
			"qwT",
		);
		expect(applyFilterKey("qw", { name: "space" })?.query).toBe("qw ");
	});

	it("backspace edits, Enter confirms keeping the query", () => {
		expect(applyFilterKey("qw", { name: "backspace" })?.query).toBe("q");
		expect(applyFilterKey("qw", { name: "return" })).toEqual({
			query: "qw",
			done: "confirm",
		});
	});

	it("Esc clears the query and exits", () => {
		expect(applyFilterKey("qw", { name: "escape" })).toEqual({
			query: "",
			done: "cancel",
		});
	});

	it("arrows are not filter edits (the caller navigates)", () => {
		expect(applyFilterKey("qw", { name: "up" })).toBeNull();
		expect(applyFilterKey("qw", { name: "down" })).toBeNull();
	});
});

describe("preset rename (Tier 3)", () => {
	const FILE: PresetFile = {
		version: 2,
		presets: [
			{
				id: "p1",
				name: "Old Name",
				model_path: "/m/a.gguf",
				flags: {},
				env_vars: {},
				created_at: "2026-08-24T00:00:00Z",
				last_used: null,
			},
			{
				id: "p2",
				name: "Other",
				model_path: "/m/b.gguf",
				flags: {},
				env_vars: {},
				created_at: "2026-08-24T00:00:00Z",
				last_used: null,
			},
		],
	};

	it("renames by id, trimming, leaving siblings untouched", () => {
		const next = renamePreset(FILE, "p1", "  New Name  ");
		expect(next.presets[0]?.name).toBe("New Name");
		expect(next.presets[1]?.name).toBe("Other");
		expect(FILE.presets[0]?.name).toBe("Old Name");
	});

	it("blank name and unknown id are no-ops", () => {
		expect(renamePreset(FILE, "p1", "   ")).toBe(FILE);
		expect(renamePreset(FILE, "nope", "X").presets[0]?.name).toBe("Old Name");
	});
});

describe("table selectRow (Tier 3 mouse)", () => {
	const COLS = [
		{ key: "name" as const, title: "NAME", width: 8, align: "left" as const },
	];
	const data = Array.from({ length: 10 }, (_, i) => ({ name: `m${i}` }));

	it("selects the clicked row and scrolls it into view", () => {
		const s = createTableState({ columns: COLS, viewport: 3 });
		const next = selectRow(s, data, 7);
		expect(next.selected).toBe(7);
		expect(next.scrollTop).toBe(5);
	});

	it("clamps out-of-range clicks", () => {
		const s = createTableState({ columns: COLS, viewport: 3 });
		expect(selectRow(s, data, 99).selected).toBe(9);
		expect(selectRow(s, data, -2).selected).toBe(0);
		expect(selectRow(s, [], 3).selected).toBe(0);
	});
});

describe("slider track offset mapping (Tier 3 mouse)", () => {
	it("maps track ends to min/max and the middle proportionally", () => {
		expect(valueAtTrackOffset(0, 17, 0, 160)).toBe(0);
		expect(valueAtTrackOffset(16, 17, 0, 160)).toBe(160);
		expect(valueAtTrackOffset(8, 17, 0, 160)).toBe(80);
	});

	it("clamps offsets outside the track", () => {
		expect(valueAtTrackOffset(-5, 17, 1, 8192)).toBe(1);
		expect(valueAtTrackOffset(99, 17, 1, 8192)).toBe(8192);
	});

	it("round-trips through trackOffsetForValue", () => {
		for (const v of [0, 20, 50, 100, 200]) {
			const off = trackOffsetForValue(v, 21, 0, 200);
			expect(valueAtTrackOffset(off, 21, 0, 200)).toBe(v);
		}
	});
});
