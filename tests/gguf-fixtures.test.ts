import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	extractModelInfo,
	headerEndOffset,
	parseGgufBytes,
} from "../src/core/gguf/parser";

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
}

const FIXTURES = [
	"llama2-7b-q4km",
	"qwen25-7b-q4km",
	"gemma3-4b-q4km",
	"deepseek2-lite-q4km",
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
