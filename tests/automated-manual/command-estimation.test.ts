import { describe, expect, it } from "bun:test";
import { estimateVram, formatBytes } from "../../src/core/estimate/vram";
import { shellQuote } from "../../src/core/export/quote";
import { buildCommand } from "../../src/core/flags/builder";
import { parseHelp } from "../../src/core/flags/help-parser";

/**
 * Automated verification for Phase 12 (Command, Estimation, and Runtime Compatibility).
 * Proves:
 * 1. Runtime --help validation correctly discovers supported/unsupported flags.
 * 2. Availability gating strips unsupported flags from built argv.
 * 3. POSIX shell quoting handles arbitrary metacharacters safely ($VAR, quotes, semicolons).
 * 4. VRAM estimation produces coherent, monotonically non-decreasing ranges with GQA/KV precision.
 */

const CANNED_HELP = `-m, --model FNAME          model path
-ngl, --n-gpu-layers N     number of layers to offload to GPU
-c, --ctx-size N           size of the prompt context
--host IP                  ip address to listen
--port PORT                port to listen
--slots                    enable slots monitoring
--metrics                  enable prometheus metrics
`;

describe("Phase 12: automated command, estimation, and runtime compatibility", () => {
	it("parses --help output and builds availability map", () => {
		const parsed = parseHelp(CANNED_HELP);

		expect(parsed.has("-ngl")).toBe(true);
		expect(parsed.has("--n-gpu-layers")).toBe(true);
		expect(parsed.has("-c")).toBe(true);
		expect(parsed.has("--port")).toBe(true);
		expect(parsed.has("--slots")).toBe(true);
		expect(parsed.has("--metrics")).toBe(true);

		// An exotic/newer flag not in the older canned output
		expect(parsed.has("--flash-attn")).toBe(false);
	});

	it("drops unsupported flags when availability map indicates missing flag", () => {
		const built = buildCommand({
			modelPath: "/models/test.gguf",
			values: {
				n_gpu_layers: 16,
				ctx_size: 4096,
				flash_attn: true, // requested by user
			},
			availability: {
				flash_attn: { supported: false, deprecated: false },
				n_gpu_layers: { supported: true, deprecated: false },
				ctx_size: { supported: true, deprecated: false },
			},
		});

		expect(built.args).toContain("-ngl");
		expect(built.args).toContain("-c");
		expect(built.args).not.toContain("-fa");
		expect(built.args).not.toContain("--flash-attn");
	});

	it("safely quotes arguments containing special shell metacharacters", () => {
		const maliciousName = "/models/model; rm -rf /; echo $HOME 'test'.gguf";
		const quoted = shellQuote(maliciousName);

		// In POSIX single-quoted format, metacharacters are escaped and cannot expand
		expect(quoted.startsWith("'")).toBe(true);
		expect(quoted.endsWith("'")).toBe(true);
		expect(quoted).toContain("'\\''test'\\''"); // inner single quotes properly escaped
	});

	it("computes coherent, monotonically non-decreasing VRAM estimates", () => {
		const baseInput = {
			fileSize: 4_000_000_000,
			blockCount: 32,
			contextLength: 4096,
			headCount: 32,
			headCountKv: 8,
			embeddingLength: 4096,
			gpuLayers: 16,
		};

		const estBase = estimateVram(baseInput);
		expect(estBase.range.low).toBeGreaterThan(0);
		expect(estBase.range.high).toBeGreaterThanOrEqual(estBase.range.low);

		// Increasing context length must increase required VRAM
		const estLongCtx = estimateVram({
			...baseInput,
			contextLength: 32768,
		});
		expect(estLongCtx.range.low).toBeGreaterThan(estBase.range.low);
		expect(estLongCtx.range.high).toBeGreaterThan(estBase.range.high);

		// Increasing offloaded layers must increase VRAM
		const estFullOffload = estimateVram({
			...baseInput,
			gpuLayers: 33,
		});
		expect(estFullOffload.range.low).toBeGreaterThan(estBase.range.low);

		// Formatted strings are valid and human-readable
		expect(formatBytes(estBase.range.low)).toMatch(
			/^[0-9.]+\s*(B|KiB|MiB|GiB|TiB)$/,
		);
	});
});
