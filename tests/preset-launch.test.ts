import { describe, expect, it } from "bun:test";
import { exportPreset, presetToPlan } from "../src/core/preset-launch";
import type { Preset } from "../src/core/store/presets";

const PRESET: Preset = {
	id: "qwen-32b-coding",
	name: "Qwen 32B Full Offload",
	model_path: "~/models/llm/qwen.gguf",
	flags: {
		n_gpu_layers: 65,
		ctx_size: 32768,
		flash_attn: true,
		cache_type_k: "q8_0",
		cache_type_v: "q8_0",
		host: "127.0.0.1",
		port: 8080,
		alias: "qwen2.5-coder",
	},
	env_vars: { CUDA_VISIBLE_DEVICES: "0" },
	created_at: "2026-08-24T00:00:00Z",
	last_used: null,
};

/** §9 Phase 4: CLI gains `llama-deck start | export` on top of the core. */
describe("presetToPlan", () => {
	it("builds deterministic argv from preset flags (P4-NFR-01)", () => {
		const plan = presetToPlan(PRESET);
		expect(plan.command).toBe("llama-server");
		expect(plan.args).toEqual([
			"-m",
			"~/models/llm/qwen.gguf",
			"-ngl",
			"65",
			"-c",
			"32768",
			"--flash-attn",
			"-ctk",
			"q8_0",
			"-ctv",
			"q8_0",
			"--host",
			"127.0.0.1",
			"--port",
			"8080",
			"-a",
			"qwen2.5-coder",
			"--slots",
			"--metrics",
		]);
		expect(plan.port).toBe(8080);
	});
});

describe("exportPreset", () => {
	it("format=cmd prints the command line", () => {
		const line = exportPreset(PRESET, "cmd");
		expect(line).toContain("llama-server -m");
		expect(line).toContain("'~/models/llm/qwen.gguf'");
	});

	it("format=sh emits a POSIX script with env + exec", () => {
		const script = exportPreset(PRESET, "sh");
		expect(script.startsWith("#!/bin/sh\n")).toBe(true);
		expect(script).toContain("export CUDA_VISIBLE_DEVICES=0");
		expect(script).toContain("\nexec llama-server -m");
	});

	it("format=systemd emits a user unit", () => {
		const unit = exportPreset(PRESET, "systemd");
		expect(unit).toContain("[Service]");
		expect(unit).toContain("Restart=on-failure");
		expect(unit).toContain(`ExecStart=`);
	});
});
