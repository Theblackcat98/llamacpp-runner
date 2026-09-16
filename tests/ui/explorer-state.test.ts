import { describe, expect, it } from "bun:test";
import type { ModelEntry } from "../../src/core/models/types";
import {
	buildRows,
	defaultVramRange,
	inspectorFor,
} from "../../src/ui/logic/explorer-state";

const GOOD: ModelEntry = {
	name: "qwen25-7b-q4km",
	path: "/models/qwen.gguf",
	paths: ["/models/qwen.gguf"],
	totalBytes: 4_681_378_816,
	architecture: "qwen2",
	quantName: "Q4_K_M",
	contextLength: 131072,
	blockCount: 28,
	embeddingLength: 3584,
	headCount: 28,
	headCountKv: 4,
	totalParams: 6_518_222_848,
	effectiveBpw: 5.75,
};

describe("explorer rows (P3-FR-15/16)", () => {
	it("formats populated rows", () => {
		const rows = buildRows([GOOD]);
		expect(rows[0]?.displayName).toBe("* qwen25-7b-q4km");
		expect(rows[0]?.sizeLabel).toMatch(/^4\.4 GiB$/);
		expect(rows[0]?.quantLabel).toBe("Q4_K_M");
		expect(rows[0]?.archLabel).toBe("qwen2");
		expect(rows[0]?.corrupt).toBe(false);
	});

	it("decorates corrupt rows with the parse-error glyph", () => {
		const corrupt: ModelEntry = {
			...GOOD,
			name: "badmagic.gguf",
			error: "BAD_MAGIC",
			architecture: undefined,
			quantName: "UNKNOWN",
		};
		const rows = buildRows([corrupt]);
		expect(rows[0]?.displayName).toBe("! badmagic.gguf");
		expect(rows[0]?.corrupt).toBe(true);
		expect(rows[0]?.sizeLabel).toBe("-");
	});

	it("prefixes nerd font file icons when iconSet is nerd (#51)", () => {
		const rows = buildRows([GOOD], "nerd");
		expect(rows[0]?.displayName).toBe("\u{F1C0} qwen25-7b-q4km");
		const corrupt: ModelEntry = { ...GOOD, name: "bad.gguf", error: "x" };
		expect(buildRows([corrupt], "nerd")[0]?.displayName).toBe(
			"\u{F071} bad.gguf",
		);
		const partial: ModelEntry = {
			...GOOD,
			name: "half.gguf",
			incomplete: true,
		};
		expect(buildRows([partial], "nerd")[0]?.displayName).toBe(
			"\u{F059} half.gguf",
		);
	});
});

describe("inspector (P3-FR-04, §2.2)", () => {
	it("shows arch, ctx max, exact params, quant + bpw", () => {
		const lines = inspectorFor(GOOD).lines;
		const get = (label: string) => lines.find((l) => l.label === label)?.value;
		expect(get("Arch")).toBe("qwen2");
		expect(get("Context Max")).toBe("131,072");
		expect(get("Params (exact)")).toBe("6.52B");
		expect(get("Quant")).toContain("Q4_K_M");
		expect(get("Quant")).toContain("~5.8 bpw");
	});

	it("flags corrupt files with a reason instead of metrics", () => {
		const bad: ModelEntry = {
			...GOOD,
			error: "TRUNCATED: file ends inside its header",
		};
		const lines = inspectorFor(bad).lines;
		expect(lines.find((l) => l.label === "Status")?.value).toBe("PARSE ERROR");
		expect(lines.some((l) => l.warn)).toBe(true);
		expect(lines.find((l) => l.label === "Params (exact)")).toBeUndefined();
	});
});

describe("default VRAM range (P3-FR-13/14)", () => {
	it("produces a labelled range at full offload + max ctx", () => {
		const range = defaultVramRange(GOOD);
		expect(range).not.toBeNull();
		if (!range) return;
		expect(range.low).toBeGreaterThan(0);
		expect(range.high).toBeGreaterThan(range.low);
	});

	it("returns null when metadata is insufficient", () => {
		const thin: ModelEntry = { ...GOOD, blockCount: undefined };
		expect(defaultVramRange(thin)).toBeNull();
	});
});
