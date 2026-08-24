import { describe, expect, it } from "bun:test";
import { buildCommand } from "../src/core/flags/builder";
import {
	FLAG_ORDER,
	type FlagEntry,
	getFlag,
	REGISTRY,
} from "../src/core/flags/registry";

/**
 * P4-FR-01..03, P4-NFR-01: registry is data; builder consumes
 * (registry + model metadata + user values) -> deterministic argv.
 */
describe("flag registry (P4-FR-01)", () => {
	it("covers every launch-critical flag id (P4-FR-02)", () => {
		const required = [
			"n_gpu_layers",
			"ctx_size",
			"batch_size",
			"ubatch_size",
			"threads",
			"flash_attn",
			"mlock",
			"no_mmap",
			"cache_type_k",
			"cache_type_v",
			"host",
			"port",
			"chat_template",
			"slots",
			"metrics",
			"alias",
		];
		for (const id of required) {
			expect(getFlag(id), `missing flag ${id}`).toBeDefined();
		}
	});

	it("entries carry cli/type/default/since/ui metadata", () => {
		const ngl = getFlag("n_gpu_layers") as FlagEntry;
		expect(ngl.cli).toContain("-ngl");
		expect(ngl.cli).toContain("--n-gpu-layers");
		expect(ngl.type).toBe("int");
		expect(ngl.max).toBe("meta:block_count+1");
		expect(ngl.ui.widget).toBe("slider");
		expect(typeof ngl.since).toBe("string");

		const host = getFlag("host") as FlagEntry;
		expect(host.default).toBe("127.0.0.1");
		const port = getFlag("port") as FlagEntry;
		expect(port.default).toBe(8080);
	});

	it("FLAG_ORDER is stable and matches REGISTRY keys", () => {
		expect([...FLAG_ORDER].sort()).toEqual(
			Object.keys(REGISTRY).sort() as typeof FLAG_ORDER,
		);
	});
});
describe("command builder (P4-FR-03)", () => {
	it("golden: full offload archetype", () => {
		const { command, args } = buildCommand({
			modelPath: "~/models/qwen2.gguf",
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
				alias: "qwen2",
			},
		});
		expect(command).toBe("llama-server");
		expect(args).toEqual([
			"-m",
			"~/models/qwen2.gguf",
			"-ngl",
			"65",
			"-c",
			"32768",
			"-b",
			"2048",
			"-ub",
			"512",
			"-t",
			"8",
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
			"qwen2",
			"--slots",
			"--metrics",
		]);
	});

	it("golden: low-VRAM archetype with KV quantized", () => {
		const { args } = buildCommand({
			modelPath: "/mnt/big/model-q4.gguf",
			meta: { blockCount: 32 },
			values: {
				n_gpu_layers: 12,
				ctx_size: 8192,
				flash_attn: true,
				cache_type_k: "q4_0",
				cache_type_v: "q4_0",
				no_mmap: false,
				mlock: false,
				port: 8090,
			},
		});
		expect(args).toEqual([
			"-m",
			"/mnt/big/model-q4.gguf",
			"-ngl",
			"12",
			"-c",
			"8192",
			"--flash-attn",
			"-ctk",
			"q4_0",
			"-ctv",
			"q4_0",
			"--port",
			"8090",
			"--slots",
			"--metrics",
		]);
	});

	it("golden: CPU-only archetype (ngl=0 explicit)", () => {
		const { args } = buildCommand({
			modelPath: "~/m/llama.gguf",
			meta: { blockCount: 16 },
			values: { n_gpu_layers: 0, ctx_size: 4096, port: 8080 },
		});
		expect(args).toEqual([
			"-m",
			"~/m/llama.gguf",
			"-ngl",
			"0",
			"-c",
			"4096",
			"--port",
			"8080",
			"--slots",
			"--metrics",
		]);
	});

	it("deterministic: same inputs -> byte-identical argv (P4-NFR-01)", () => {
		const mk = () =>
			buildCommand({
				modelPath: "a.gguf",
				meta: { blockCount: 10 },
				values: { ctx_size: 2048, flash_attn: true },
			}).args.join("\u0000");
		expect(mk()).toBe(mk());
	});

	it("clamps ngl to meta:block_count+1 from selected model", () => {
		const { args } = buildCommand({
			modelPath: "a.gguf",
			meta: { blockCount: 31 },
			values: { n_gpu_layers: 999 },
		});
		expect(args[args.indexOf("-ngl") + 1]).toBe("32");
	});

	it("telemetry pair auto-injected while enabled, omittable (P4-FR-11)", () => {
		const on = buildCommand({
			modelPath: "a.gguf",
			values: {},
		}).args;
		expect(on.filter((a) => a === "--slots" || a === "--metrics").length).toBe(
			2,
		);
		const explicitOff = buildCommand({
			modelPath: "a.gguf",
			values: { slots: false, metrics: false },
		}).args;
		expect(explicitOff).not.toContain("--slots");
		expect(explicitOff).not.toContain("--metrics");
	});

	it("string values are passed verbatim in argv (quoting is exporter concern)", () => {
		const { args } = buildCommand({
			modelPath: "~/models/a b.gguf",
			values: { alias: 'my "model"', chat_template: "chatml" },
		});
		expect(args[args.indexOf("-a") + 1]).toBe('my "model"');
		expect(args[args.indexOf("--chat-template") + 1]).toBe("chatml");
	});

	it("unknown values are ignored by the builder (round-trip lives in store)", () => {
		const { args } = buildCommand({
			modelPath: "a.gguf",
			values: { not_a_flag: 42 },
		});
		expect(args).toEqual(["-m", "a.gguf", "--slots", "--metrics"]);
	});
});
