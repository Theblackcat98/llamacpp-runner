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
import type { GgufHeader } from "../../../src/core/gguf/types";

export interface CaptureSource {
	readonly name: string;
	readonly url: string;
	readonly expectParamsNear: number;
	/** Raw KV keys recorded as extra metadata parity fixtures (new shapes). */
	readonly expectKv?: readonly string[];
	/** Range window size in bytes; defaults to 8 MiB. */
	readonly fetchBytes?: number;
}

export type ExtraKvJson =
	| number
	| string
	| boolean
	| { itemType: string; values: (number | string | boolean)[] };

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
	extraKv?: Record<string, ExtraKvJson>;
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
	{
		name: "llama3-8b-instruct-q4km",
		url: "https://huggingface.co/bartowski/Meta-Llama-3-8B-Instruct-GGUF/resolve/main/Meta-Llama-3-8B-Instruct-Q4_K_M.gguf",
		expectParamsNear: 8_030_354_432,
		expectKv: ["llama.rope.freq_base"],
	},
	{
		name: "yarn-mistral-7b-64k-q4km",
		url: "https://huggingface.co/TheBloke/Yarn-Mistral-7B-64k-GGUF/resolve/main/yarn-mistral-7b-64k.Q4_K_M.gguf",
		expectParamsNear: 7_241_732_096,
		expectKv: [
			"llama.rope.scaling.type",
			"llama.rope.scaling.factor",
			"llama.rope.scaling.original_context_length",
			"llama.rope.scaling.finetuned",
		],
	},
	{
		name: "phi3-mini-4k-q4km",
		url: "https://huggingface.co/bartowski/Phi-3-mini-4k-instruct-GGUF/resolve/main/Phi-3-mini-4k-instruct-Q4_K_M.gguf",
		expectParamsNear: 3_821_436_416,
		expectKv: ["phi3.context_length"],
	},
	{
		name: "command-r-v01-q4km",
		url: "https://huggingface.co/bartowski/c4ai-command-r-v01-GGUF/resolve/main/c4ai-command-r-v01-Q4_K_M.gguf",
		expectParamsNear: 35_000_000_000,
		expectKv: ["command-r.context_length"],
		fetchBytes: 32 * 1024 * 1024,
	},
	{
		name: "qwen3-30b-a3b-q4km",
		url: "https://huggingface.co/Qwen/Qwen3-30B-A3B-GGUF/resolve/main/Qwen3-30B-A3B-Q4_K_M.gguf",
		expectParamsNear: 30_500_000_000,
		expectKv: ["qwen3moe.expert_count", "qwen3moe.expert_used_count"],
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
		"extraKv",
	];
	const diffs: DriftDiff[] = [];
	for (const f of fields) {
		let differs = committed[f] !== upstream[f];
		if (f === "extraKv") {
			differs = JSON.stringify(committed[f]) !== JSON.stringify(upstream[f]);
		}
		if (differs) {
			diffs.push({ field: f, committed: committed[f], upstream: upstream[f] });
		}
	}
	return diffs;
}

function toExtraKv(
	header: GgufHeader,
	keys: readonly string[] | undefined,
): Record<string, ExtraKvJson> | undefined {
	if (!keys || keys.length === 0) return undefined;
	const out: Record<string, ExtraKvJson> = {};
	for (const key of keys) {
		const v = header.kv.get(key);
		if (v === undefined)
			throw new Error(`capture: expected KV ${key} absent from header`);
		if (typeof v === "bigint")
			throw new Error(`capture: KV ${key} bigint is not JSON-safe`);
		if (typeof v === "object") {
			const values: (number | string | boolean)[] = v.values.map((x) => {
				if (typeof x === "bigint")
					throw new Error(`capture: KV ${key} bigint array is not JSON-safe`);
				return x;
			});
			out[key] = { itemType: v.itemType, values };
		} else {
			out[key] = v;
		}
	}
	return out;
}

export function buildExpectedModelJson(
	src: CaptureSource,
	end: number,
	chunk: Uint8Array,
): ExpectedModelJson {
	const header = parseGgufBytes(chunk);
	const info = extractModelInfo(header);
	return {
		source: src.url,
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
		extraKv: toExtraKv(header, src.expectKv),
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
		const windowBytes = src.fetchBytes ?? 8 * 1024 * 1024;
		let chunk = await fetchRange(src.url, 0, windowBytes - 1);
		const end = headerEndOffset(chunk);
		if (end >= chunk.byteLength)
			throw new Error(`${src.name}: header spans capture window`);
		chunk = chunk.slice(0, end);

		const expected = buildExpectedModelJson(src, end, chunk);

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
