import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	extractModelInfo,
	headerEndOffset,
	parseGgufBytes,
} from "../src/core/gguf/parser";
import type { MetadataArray, ScalarTypeName } from "../src/core/gguf/types";

interface ExtraKvArray {
	itemType: string;
	values: (number | string | boolean)[];
}

type ExtraKvJson = number | string | boolean | ExtraKvArray;

interface ExpectedFixture {
	source: string;
	headerBytes: number;
	architecture: string;
	quantName: string;
	contextLength: number;
	blockCount: number;
	embeddingLength: number;
	headCount: number;
	headCountKv: number;
	keyLength: number | null;
	vocabSize: number | null;
	totalParams: number;
	extraKv?: Record<string, ExtraKvJson>;
}

const FIXTURES = [
	"llama2-7b-q4km",
	"qwen25-7b-q4km",
	"gemma3-4b-q4km",
	"deepseek2-lite-q4km",
	"llama3-8b-instruct-q4km",
	"yarn-mistral-7b-64k-q4km",
	"phi3-mini-4k-q4km",
	"command-r-v01-q4km",
	"qwen3-30b-a3b-q4km",
] as const;

describe("GGUF parser vs REAL captured headers (§8, P3-FR-01..06)", () => {
	for (const name of FIXTURES) {
		it(`extracts every known-good field for ${name}`, () => {
			const bytes = readFileSync(
				join(import.meta.dir, "fixtures/gguf", `${name}.ggufheader`),
			);
			const expected = JSON.parse(
				readFileSync(
					join(import.meta.dir, "fixtures/gguf", `${name}.json`),
					"utf8",
				),
			) as ExpectedFixture;

			expect(headerEndOffset(bytes)).toBe(expected.headerBytes);

			const header = parseGgufBytes(bytes);
			expect(header.version).toBeGreaterThanOrEqual(2);
			expect(header.tensors.length).toBeGreaterThan(100);

			const info = extractModelInfo(header);
			expect(info.architecture).toBe(expected.architecture);
			expect(info.quantName).toBe(expected.quantName);
			expect(info.contextLength).toBe(expected.contextLength);
			expect(info.blockCount).toBe(expected.blockCount);
			expect(info.embeddingLength).toBe(expected.embeddingLength);
			expect(info.headCount).toBe(expected.headCount);
			expect(info.headCountKv).toBe(expected.headCountKv);
			if (expected.keyLength === null) {
				expect(info.keyLength).toBeUndefined();
			} else {
				expect(info.keyLength).toBe(expected.keyLength);
			}
			expect(info.totalParams).toBe(expected.totalParams);

			if (expected.extraKv) {
				for (const [key, want] of Object.entries(expected.extraKv)) {
					const got = header.kv.get(key);
					if (typeof want === "object") {
						const gotArr = got as MetadataArray | undefined;
						expect(gotArr?.kind).toBe("array");
						expect(gotArr?.itemType).toBe(want.itemType as ScalarTypeName);
						expect(gotArr?.values).toEqual(want.values);
					} else {
						expect(got).toBe(want);
					}
				}
			}
		});
	}

	it("matches llama-2-7B published param count exactly", () => {
		const bytes = readFileSync(
			join(import.meta.dir, "fixtures/gguf/llama2-7b-q4km.ggufheader"),
		);
		expect(extractModelInfo(parseGgufBytes(bytes)).totalParams).toBe(
			6_738_415_616,
		);
	});

	it("matches DeepSeek-V2-Lite published 15.7B param count", () => {
		const bytes = readFileSync(
			join(import.meta.dir, "fixtures/gguf/deepseek2-lite-q4km.ggufheader"),
		);
		expect(extractModelInfo(parseGgufBytes(bytes)).totalParams).toBe(
			15_706_484_224,
		);
	});

	it("captures llama-family rope-scaling metadata (Idea A shape)", () => {
		const bytes = readFileSync(
			join(
				import.meta.dir,
				"fixtures/gguf/yarn-mistral-7b-64k-q4km.ggufheader",
			),
		);
		const header = parseGgufBytes(bytes);
		expect(header.kv.get("general.architecture")).toBe("llama");
		expect(header.kv.get("llama.rope.scaling.type")).toBe("yarn");
		expect(header.kv.get("llama.rope.scaling.factor")).toBe(8);
		expect(header.kv.get("llama.rope.scaling.original_context_length")).toBe(
			8192,
		);
		expect(header.kv.get("llama.rope.scaling.finetuned")).toBe(true);
		const info = extractModelInfo(header);
		expect(info.contextLength).toBe(32768);
	});

	it("captures qwen3moe expert-count metadata beyond deepseek2 (Idea A shape)", () => {
		const bytes = readFileSync(
			join(import.meta.dir, "fixtures/gguf/qwen3-30b-a3b-q4km.ggufheader"),
		);
		const header = parseGgufBytes(bytes);
		expect(header.kv.get("general.architecture")).toBe("qwen3moe");
		expect(header.kv.get("qwen3moe.expert_count")).toBe(128);
		expect(header.kv.get("qwen3moe.expert_used_count")).toBe(8);
	});

	it("captures phi3 and command-r architectures with parity", () => {
		const phi = parseGgufBytes(
			readFileSync(
				join(import.meta.dir, "fixtures/gguf/phi3-mini-4k-q4km.ggufheader"),
			),
		);
		expect(phi.kv.get("general.architecture")).toBe("phi3");
		const cmdr = parseGgufBytes(
			readFileSync(
				join(import.meta.dir, "fixtures/gguf/command-r-v01-q4km.ggufheader"),
			),
		);
		expect(cmdr.kv.get("general.architecture")).toBe("command-r");
	});

	it("computes effective bpw for a real file size (P3-FR-06)", async () => {
		const { computeEffectiveBpw } = await import("../src/core/gguf/parser");
		const bytes = readFileSync(
			join(import.meta.dir, "fixtures/gguf/llama2-7b-q4km.ggufheader"),
		);
		const params = extractModelInfo(parseGgufBytes(bytes)).totalParams;
		const q4FileSize = 3_897_308_464;
		expect(computeEffectiveBpw(params, q4FileSize)).toBeCloseTo(4.63, 1);
	});
});
