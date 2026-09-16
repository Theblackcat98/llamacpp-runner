import { describe, expect, it } from "bun:test";
import {
	type CaptureSource,
	checkSourceDrift,
	type ExpectedModelJson,
} from "./capture";

describe("GGUF capture --check drift detection", () => {
	const _mockSource: CaptureSource = {
		name: "test-model",
		url: "https://example.com/model.gguf",
		expectParamsNear: 7_000_000_000,
	};

	const committedExpected: ExpectedModelJson = {
		source: "https://example.com/model.gguf",
		headerBytes: 1024,
		architecture: "llama",
		quantName: "Q4_K_M",
		contextLength: 4096,
		blockCount: 32,
		embeddingLength: 4096,
		headCount: 32,
		headCountKv: 32,
		keyLength: null,
		vocabSize: 32000,
		totalParams: 6_738_415_616,
	};

	it("detects no drift when upstream metadata matches committed json", () => {
		const upstream = { ...committedExpected };
		const diffs = checkSourceDrift(committedExpected, upstream);
		expect(diffs).toHaveLength(0);
	});

	it("detects drift when headerBytes or architecture changes", () => {
		const upstream: ExpectedModelJson = {
			...committedExpected,
			headerBytes: 2048,
			architecture: "llama3",
		};
		const diffs = checkSourceDrift(committedExpected, upstream);
		expect(diffs).toEqual([
			{ field: "headerBytes", committed: 1024, upstream: 2048 },
			{ field: "architecture", committed: "llama", upstream: "llama3" },
		]);
	});

	it("detects drift in contextLength or totalParams", () => {
		const upstream: ExpectedModelJson = {
			...committedExpected,
			contextLength: 8192,
			totalParams: 7_000_000_000,
		};
		const diffs = checkSourceDrift(committedExpected, upstream);
		expect(diffs).toEqual([
			{ field: "contextLength", committed: 4096, upstream: 8192 },
			{
				field: "totalParams",
				committed: 6_738_415_616,
				upstream: 7_000_000_000,
			},
		]);
	});

	it("detects drift in extraKv shape metadata", () => {
		const withKv: ExpectedModelJson = {
			...committedExpected,
			extraKv: {
				"llama.rope_scaling": { itemType: "f32", values: [8, 1, 4, 8192] },
			},
		};
		const noDrift = checkSourceDrift(withKv, {
			...withKv,
			extraKv: {
				"llama.rope_scaling": { itemType: "f32", values: [8, 1, 4, 8192] },
			},
		});
		expect(noDrift).toHaveLength(0);

		const drifted = checkSourceDrift(withKv, {
			...withKv,
			extraKv: {
				"llama.rope_scaling": { itemType: "f32", values: [16, 1, 4, 8192] },
			},
		});
		expect(drifted).toHaveLength(1);
		expect(drifted[0]?.field).toBe("extraKv");
	});
});
