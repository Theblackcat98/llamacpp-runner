import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildShellScript } from "../../src/core/export/sh";
import { buildCommand } from "../../src/core/flags/builder";
import {
	parseShellCommand,
	tokenizeShellScript,
} from "../../src/core/import/shell";

describe("Strict POSIX shell command tokenizer (#5)", () => {
	it("parses single command line with bare words, flags, and single quotes", () => {
		const cmd =
			"llama-server -m '~/models/test.gguf' -c 4096 --flash-attn --host 127.0.0.1";
		const tokens = tokenizeShellScript(cmd);
		expect(tokens.argv).toEqual([
			"llama-server",
			"-m",
			"~/models/test.gguf",
			"-c",
			"4096",
			"--flash-attn",
			"--host",
			"127.0.0.1",
		]);
	});

	it("handles comments, line continuations, and leading $", () => {
		const script = `
# Sample bash command
$ llama-server \\
  -m model.gguf \\
  -ngl 33
`;
		const tokens = tokenizeShellScript(script);
		expect(tokens.argv).toEqual([
			"llama-server",
			"-m",
			"model.gguf",
			"-ngl",
			"33",
		]);
	});

	it("handles export KEY=val lines", () => {
		const script = `
export CUDA_VISIBLE_DEVICES=0
export LLAMA_ARG_HOST='0.0.0.0'
exec llama-server -m model.gguf
`;
		const tokens = tokenizeShellScript(script);
		expect(tokens.envVars).toEqual({
			CUDA_VISIBLE_DEVICES: "0",
			LLAMA_ARG_HOST: "0.0.0.0",
		});
		expect(tokens.argv).toEqual(["llama-server", "-m", "model.gguf"]);
	});

	it("handles escaped single quotes within single quotes ('\\'')", () => {
		const cmd = "llama-server -m 'foo'\\''bar.gguf'";
		const tokens = tokenizeShellScript(cmd);
		expect(tokens.argv).toEqual(["llama-server", "-m", "foo'bar.gguf"]);
	});

	it("hard-rejects double quotes with clear token error", () => {
		expect(() => tokenizeShellScript('llama-server -m "test.gguf"')).toThrow(
			/double quote/i,
		);
	});

	it("hard-rejects variable expansions ($var) with clear token error", () => {
		expect(() => tokenizeShellScript("llama-server -m $MODEL_PATH")).toThrow(
			/variable expansion/i,
		);
	});

	it("hard-rejects control operators (&&, ;, |, >, <)", () => {
		expect(() =>
			tokenizeShellScript("llama-server -m test.gguf && echo done"),
		).toThrow(/operator/i);
		expect(() =>
			tokenizeShellScript("llama-server -m test.gguf; echo done"),
		).toThrow(/operator/i);
		expect(() =>
			tokenizeShellScript("llama-server -m test.gguf | grep ok"),
		).toThrow(/operator/i);
	});
});

describe("Shell command importer to preset mapping (#5)", () => {
	it("resolves cli flags and aliases to registry IDs", () => {
		const cmd =
			"llama-server -m /path/to/model.gguf -ngl 33 -c 8192 -t 4 --flash-attn -b 1024 -ub 256";
		const result = parseShellCommand(cmd);
		expect(result.modelPath).toBe("/path/to/model.gguf");
		expect(result.values).toEqual({
			n_gpu_layers: 33,
			ctx_size: 8192,
			threads: 4,
			flash_attn: true,
			batch_size: 1024,
			ubatch_size: 256,
		});
	});

	it("flags unknown options cleanly instead of silently dropping", () => {
		const cmd = "llama-server -m model.gguf --unknown-flag foo";
		const result = parseShellCommand(cmd);
		expect(result.unknownFlags).toContain("--unknown-flag");
	});

	it("round-trip byte-identity invariant with sh export", () => {
		const golden = readFileSync(
			join(import.meta.dir, "../fixtures/export/full-offload.sh.golden"),
			"utf8",
		);
		const imported = parseShellCommand(golden);
		expect(imported.modelPath).toBe(
			"~/models/llm/qwen2.5-coder-32b-q4_k_m.gguf",
		);

		const built = buildCommand({
			modelPath: imported.modelPath,
			values: imported.values,
			telemetry: true,
		});

		const reExported = buildShellScript({
			built,
			envVars: imported.envVars,
			presetName: "Qwen 2.5 Coder 32B (Full Offload)",
		});

		expect(reExported).toBe(golden);
	});
});
