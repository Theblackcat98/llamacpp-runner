import { describe, expect, it } from "bun:test";
import {
	groupSplitFiles,
	isGroupComplete,
	type SplitCandidate,
	splitBase,
} from "../src/core/models/split-grouping";

function cand(name: string): SplitCandidate {
	return { name, path: `/models/${name}` };
}

describe("split-file grouping (P3-FR-09)", () => {
	it("collapses *-0000N-of-0000M.gguf siblings to one entry", () => {
		const files = [
			cand("qwen-00001-of-00003.gguf"),
			cand("qwen-00002-of-00003.gguf"),
			cand("qwen-00003-of-00003.gguf"),
			cand("standalone.gguf"),
		];
		const groups = groupSplitFiles(files);
		expect(groups.get("qwen")?.map((f) => f.name)).toEqual([
			"qwen-00001-of-00003.gguf",
			"qwen-00002-of-00003.gguf",
			"qwen-00003-of-00003.gguf",
		]);
		expect(groups.has("standalone")).toBe(false);
	});

	it("extracts base names correctly", () => {
		expect(splitBase("model-00001-of-00004.gguf")).toBe("model");
		expect(splitBase("Llama-3.1-8B-IQ4_XS-00002-of-00002.gguf")).toBe(
			"Llama-3.1-8B-IQ4_XS",
		);
		expect(splitBase("plain.gguf")).toBeUndefined();
		expect(splitBase("fake-0001-of-0002.gguf")).toBeUndefined();
	});

	it("marks groups with missing siblings incomplete", () => {
		const files = [
			cand("m-00001-of-00003.gguf"),
			cand("m-00003-of-00003.gguf"),
		];
		const groups = groupSplitFiles(files);
		const g = groups.get("m");
		expect(g).toBeDefined();
		if (g) expect(isGroupComplete(g)).toBe(false);
	});

	it("complete contiguous run is complete", () => {
		const g = groupSplitFiles([
			cand("x-00001-of-00002.gguf"),
			cand("x-00002-of-00002.gguf"),
		]).get("x");
		expect(g).toBeDefined();
		expect(isGroupComplete(g ?? [])).toBe(true);
	});
});
