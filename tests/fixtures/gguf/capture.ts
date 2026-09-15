/**
 * Captures REAL GGUF headers from public HuggingFace models via HTTP range
 * requests and stores them as binary fixtures + expected-value JSON.
 *
 * Run: bun run tests/fixtures/gguf/capture.ts [--check]
 * Committed artifacts: tests/fixtures/gguf/<name>.ggufheader + <name>.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	extractModelInfo,
	headerEndOffset,
	parseGgufBytes,
} from "../../../src/core/gguf/parser";

export interface CaptureSource {
	readonly name: string;
	readonly url: string;
	readonly expectParamsNear: number;
}

export interface ExpectedModelJson {
	source: string;
	headerBytes: number;
	architecture: string | null;
	quantName: string | null;
	contextLength: number | null;
	blockCount: number | null;
	embeddingLength: number | null;
	headCount: number | null;
	headCountKv: number | null;
	keyLength: number | null;
	vocabSize: number | null;
	totalParams: number;
}

export interface DriftDiff {
	field: keyof ExpectedModelJson;
	committed: unknown;
	upstream: unknown;
}

export const SOURCES: readonly CaptureSource[] = [
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

export const OUT = import.meta.dir;

export function checkSourceDrift(
	committed: ExpectedModelJson,
	upstream: ExpectedModelJson,
): DriftDiff[] {
	const fields: (keyof ExpectedModelJson)[] = [
		"headerBytes",
		"architecture",
		"quantName",
		"contextLength",
		"blockCount",
		"embeddingLength",
		"headCount",
		"headCountKv",
		"keyLength",
		"vocabSize",
		"totalParams",
	];
	const diffs: DriftDiff[] = [];
	for (const f of fields) {
		if (committed[f] !== upstream[f]) {
			diffs.push({ field: f, committed: committed[f], upstream: upstream[f] });
		}
	}
	return diffs;
}

export function buildExpectedModelJson(
	url: string,
	end: number,
	chunk: Uint8Array,
): ExpectedModelJson {
	const info = extractModelInfo(parseGgufBytes(chunk));
	return {
		source: url,
		headerBytes: end,
		architecture: info.architecture ?? null,
		quantName: info.quantName ?? null,
		contextLength: info.contextLength ?? null,
		blockCount: info.blockCount ?? null,
		embeddingLength: info.embeddingLength ?? null,
		headCount: info.headCount ?? null,
		headCountKv: info.headCountKv ?? null,
		keyLength: info.keyLength ?? null,
		vocabSize: info.vocabSize ?? null,
		totalParams: info.totalParams,
	};
}

export async function fetchRange(
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

async function main() {
	const checkMode = process.argv.includes("--check");
	let hasDrift = false;

	for (const src of SOURCES) {
		console.log(`Fetching header for ${src.name} (${src.url})...`);
		let chunk = await fetchRange(src.url, 0, 8 * 1024 * 1024 - 1);
		const end = headerEndOffset(chunk);
		if (end >= chunk.byteLength)
			throw new Error(`${src.name}: header spans capture window`);
		chunk = chunk.slice(0, end);

		const expected = buildExpectedModelJson(src.url, end, chunk);

		if (checkMode) {
			const jsonPath = join(OUT, `${src.name}.json`);
			const committedJson: ExpectedModelJson = JSON.parse(
				readFileSync(jsonPath, "utf8"),
			);
			const diffs = checkSourceDrift(committedJson, expected);
			if (diffs.length > 0) {
				hasDrift = true;
				console.error(
					`[DRIFT] ${src.name} differs from committed expected JSON:`,
				);
				for (const d of diffs) {
					console.error(
						`  - ${d.field}: committed=${JSON.stringify(d.committed)}, upstream=${JSON.stringify(d.upstream)}`,
					);
				}
			} else {
				console.log(`[OK] ${src.name}: matches committed metadata.`);
			}
		} else {
			writeFileSync(join(OUT, `${src.name}.ggufheader`), chunk);
			writeFileSync(
				join(OUT, `${src.name}.json`),
				`${JSON.stringify(expected, null, "\t")}\n`,
			);
			console.log(
				`${src.name}: ${end} B header, arch=${expected.architecture} quant=${expected.quantName} params=${expected.totalParams}`,
			);
			if (
				Math.abs(expected.totalParams - src.expectParamsNear) /
					src.expectParamsNear >
				0.05
			) {
				console.warn(
					`  WARNING: params ${expected.totalParams} differs >5% from expected ${src.expectParamsNear}`,
				);
			}
		}
	}

	if (checkMode && hasDrift) {
		process.exit(1);
	}
}

if (import.meta.main) {
	await main();
}
