import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildShellScript } from "../src/core/export/sh";
import { buildSystemdUnit } from "../src/core/export/systemd";
import { buildCommand } from "../src/core/flags/builder";

const FULL_OFFLOAD = buildCommand({
	modelPath: "~/models/llm/qwen2.5-coder-32b-q4_k_m.gguf",
	meta: { blockCount: 64 },
	values: {
		n_gpu_layers: 65,
		ctx_size: 32768,
		batch_size: 2048,
		ubatch_size: 512,
		threads: 8,
		flash_attn: true,
		cache_type_k: "q8_0",
		cache_type_v: "q8_0",
		host: "127.0.0.1",
		port: 8080,
		alias: "qwen2.5-coder",
	},
});

/** P4-FR-16: exporters produce stable golden output (§8). */
describe("sh exporter", () => {
	it("golden: full offload preset with env vars + exec", () => {
		const script = buildShellScript({
			built: FULL_OFFLOAD,
			envVars: { CUDA_VISIBLE_DEVICES: "0" },
			presetName: "Qwen 2.5 Coder 32B (Full Offload)",
		});
		const golden = readFileSync(
			join(import.meta.dir, "fixtures/export/full-offload.sh.golden"),
			"utf8",
		);
		expect(script).toBe(golden);
	});

	it("script is POSIX sh with exec line", () => {
		const script = buildShellScript({
			built: buildCommand({ modelPath: "m.gguf", values: {} }),
			envVars: {},
			presetName: "minimal",
		});
		expect(script.startsWith("#!/bin/sh\n")).toBe(true);
		expect(script).toContain("\nexec llama-server -m m.gguf");
	});
});

describe("systemd exporter", () => {
	it("golden: user unit with Type=simple Restart=on-failure ExecStart", () => {
		const unit = buildSystemdUnit({
			built: FULL_OFFLOAD,
			envVars: { CUDA_VISIBLE_DEVICES: "0" },
			description: "llama-deck: Qwen 2.5 Coder 32B (Full Offload)",
		});
		const golden = readFileSync(
			join(import.meta.dir, "fixtures/export/full-offload.service.golden"),
			"utf8",
		);
		expect(unit).toBe(golden);
	});

	it("quotes values containing spaces in Environment= and ExecStart=", () => {
		const unit = buildSystemdUnit({
			built: buildCommand({ modelPath: "/opt/my models/a.gguf", values: {} }),
			envVars: { LLAMA_CACHE: "/home/u/My Cache" },
			description: "quoted",
		});
		expect(unit).toContain('Environment="LLAMA_CACHE=/home/u/My Cache"');
		expect(unit).toContain('"/opt/my models/a.gguf"');
	});
});

describe("exporter sanitization (#62)", () => {
	const HOSTILE_NAME = "evil\nrm -rf /\n# injected";

	it("sh comment stays one line with control chars stripped", () => {
		const script = buildShellScript({
			built: { command: "llama-server", args: ["-m", "x.gguf"] },
			envVars: {},
			presetName: HOSTILE_NAME,
		});
		// Exactly the golden shape: shebang, one comment line, generated-by,
		// blank, exec, trailing newline — the name never adds lines.
		expect(script.split("\n").length).toBe(6);
		expect(script).toContain("# llama-deck preset: evil rm -rf / # injected");
		// The hostile lines exist only inside the inert comment.
		for (const line of script.split("\n")) {
			expect(line.startsWith("rm -rf")).toBe(false);
			expect(line.startsWith("# injected")).toBe(false);
		}
	});

	it("invalid env keys are never exported", () => {
		const script = buildShellScript({
			built: { command: "llama-server", args: [] },
			envVars: {
				OK_KEY: "1",
				"BAD-KEY": "x",
				"A B": "y",
				"X\nY": "z",
				"1STARTS": "w",
			},
			presetName: "fine",
		});
		expect(script).toContain("export OK_KEY=1");
		expect(script).not.toContain("BAD-KEY");
		expect(script).not.toContain("A B");
		expect(script).not.toContain("X\nY");
		expect(script).not.toContain("1STARTS");
	});

	it("systemd Description and Environment keys are sanitized the same way", () => {
		const unit = buildSystemdUnit({
			built: { command: "llama-server", args: [] },
			envVars: { OK: "1", "BAD KEY": "x" },
			description: HOSTILE_NAME,
		});
		expect(unit.split("\n").length).toBe(12);
		expect(unit).toContain("Description=evil rm -rf / # injected");
		expect(unit).toContain('Environment="OK=1"');
		expect(unit).not.toContain("BAD KEY");
	});
});
