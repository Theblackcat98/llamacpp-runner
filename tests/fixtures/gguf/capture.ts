/**
 * Captures REAL GGUF headers from public HuggingFace models via HTTP range
 * requests and stores them as binary fixtures + expected-value JSON.
 *
 * Run: bun run tests/fixtures/gguf/capture.ts
 * Committed artifacts: tests/fixtures/gguf/<name>.ggufheader + <name>.json
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	extractModelInfo,
	headerEndOffset,
} from "../../../src/core/gguf/parser";

const SOURCES = [
	{
		name: "llama2-7b-q4km",
		url: "https://huggingface.co/TheBloke/Llama-2-7B-Chat-GGUF/resolve/main/llama-2-7b-chat.Q4_K_M.gguf",
		expectParamsNear: 6_738_415_616,
	},
	{
		name: "qwen25-7b-q4km",
		url: "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf",
		expectParamsNear: 6_518_222_848,
	},
	{
		name: "gemma3-4b-q4km",
		url: "https://huggingface.co/bartowski/google_gemma-3-4b-it-GGUF/resolve/main/google_gemma-3-4b-it-Q4_K_M.gguf",
		expectParamsNear: 3_880_099_328,
	},
	{
		name: "deepseek2-lite-q4km",
		url: "https://huggingface.co/mradermacher/DeepSeek-V2-Lite-GGUF/resolve/main/DeepSeek-V2-Lite.Q4_K_M.gguf",
		expectParamsNear: 15_706_484_224,
	},
] as const;

const OUT = import.meta.dir;

async function fetchRange(
	url: string,
	start: number,
	end: number,
): Promise<Uint8Array> {
	const res = await fetch(url, {
		headers: { Range: `bytes=${start}-${end}` },
		redirect: "follow",
	});
	if (!res.ok && res.status !== 206) {
		throw new Error(`${url}: HTTP ${res.status}`);
	}
	return new Uint8Array(await res.arrayBuffer());
}

for (const src of SOURCES) {
	let chunk = await fetchRange(src.url, 0, 8 * 1024 * 1024 - 1);
	const end = headerEndOffset(chunk);
	if (end >= chunk.byteLength)
		throw new Error(`${src.name}: header spans capture window`);
	chunk = chunk.slice(0, end);

	writeFileSync(join(OUT, `${src.name}.ggufheader`), chunk);
	const { parseGgufBytes } = await import("../../../src/core/gguf/parser");
	const info = extractModelInfo(parseGgufBytes(chunk));
	const expected = {
		source: src.url,
		headerBytes: end,
		architecture: info.architecture,
		quantName: info.quantName,
		contextLength: info.contextLength,
		blockCount: info.blockCount,
		embeddingLength: info.embeddingLength,
		headCount: info.headCount,
		headCountKv: info.headCountKv,
		keyLength: info.keyLength ?? null,
		vocabSize: info.vocabSize ?? null,
		totalParams: info.totalParams,
	};
	writeFileSync(
		join(OUT, `${src.name}.json`),
		`${JSON.stringify(expected, null, "\t")}\n`,
	);
	console.log(
		`${src.name}: ${end} B header, arch=${info.architecture} quant=${info.quantName} params=${info.totalParams}`,
	);
	if (
		Math.abs(info.totalParams - src.expectParamsNear) / src.expectParamsNear >
		0.05
	) {
		console.warn(
			`  WARNING: params ${info.totalParams} differs >5% from expected ${src.expectParamsNear}`,
		);
	}
}
