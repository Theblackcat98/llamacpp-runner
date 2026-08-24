import { describe, it } from "bun:test";
import type { ModelEntry } from "../../../src/core/models/types";
import { Explorer } from "../../../src/ui/screens/explorer";
import { TOKYO_NIGHT } from "../../../src/ui/themes";
import { expectGoldenFrame } from "./harness";

const POPULATED: ModelEntry[] = [
	{
		name: "qwen25-7b-q4km.gguf",
		path: "/models/llm/qwen25-7b-q4km.gguf",
		paths: ["/models/llm/qwen25-7b-q4km.gguf"],
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
	},
	{
		name: "tinyllama-1.1b-q8_0.gguf",
		path: "/models/llm/tinyllama-1.1b-q8_0.gguf",
		paths: ["/models/llm/tinyllama-1.1b-q8_0.gguf"],
		totalBytes: 1_137_571_840,
		architecture: "llama",
		quantName: "Q8_0",
		contextLength: 2048,
		blockCount: 22,
		embeddingLength: 2048,
		headCount: 32,
		headCountKv: 4,
		totalParams: 1_100_048_384,
		effectiveBpw: 8.27,
	},
];

const WITH_BAD_ROW: ModelEntry[] = [
	...POPULATED,
	{
		name: "corrupt.gguf",
		path: "/models/llm/corrupt.gguf",
		paths: ["/models/llm/corrupt.gguf"],
		totalBytes: 4096,
		quantName: "UNKNOWN",
		error: "BAD_MAGIC",
	},
];

describe("explorer golden frames (P3-FR-15/16)", () => {
	it("renders the populated explorer", async () => {
		await expectGoldenFrame(
			"explorer-populated",
			<Explorer
				theme={TOKYO_NIGHT}
				entries={POPULATED}
				modelsDir="/models/llm"
			/>,
			{ width: 100, height: 22 },
		);
	});

	it("renders corrupt rows with parse-error glyph + reason", async () => {
		await expectGoldenFrame(
			"explorer-corrupt-row",
			<Explorer
				theme={TOKYO_NIGHT}
				entries={WITH_BAD_ROW}
				modelsDir="/models/llm"
			/>,
			{ width: 100, height: 22 },
		);
	});
});
