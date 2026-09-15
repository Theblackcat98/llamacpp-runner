import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

afterAll(() => {
	rmSync(join(ROOT, ".tmp/exit-gate"), { recursive: true, force: true });
});

describe("Phase 5 EXIT gate (spec §9)", () => {
	it("§7 audit table exists and every referenced test file is present", () => {
		const doc = readFileSync(join(ROOT, "docs/error-audit.md"), "utf8");
		const refs = [...doc.matchAll(/tests\/[A-Za-z0-9/._-]+/g)].map((m) =>
			m[0].replace(/[.,]$/, ""),
		);
		expect(refs.length).toBeGreaterThanOrEqual(15);
		for (const ref of new Set(refs)) {
			expect(existsSync(join(ROOT, ref))).toBe(true);
		}
	});

	it("§7 audit covers all 11 inventory rows", () => {
		const doc = readFileSync(join(ROOT, "docs/error-audit.md"), "utf8");
		for (const row of [
			"Port in use",
			"VRAM OOM",
			"Model file missing",
			"Corrupt GGUF",
			"Multi-part GGUF",
			"First run",
			"not on PATH",
			"Binary too old",
			"below 100x30",
			"TUI crash mid-session",
			"Sibling deleted|sibling deleted|Split-file sibling deleted",
		]) {
			expect(new RegExp(row, "i").test(doc)).toBe(true);
		}
	});

	it("compat matrix document exists with the 6 required terminals", () => {
		const doc = readFileSync(join(ROOT, "docs/compat-matrix.md"), "utf8");
		for (const term of [
			"tmux",
			"kitty",
			"ghostty",
			"wezterm",
			"alacritty",
			"VSCode",
		]) {
			expect(doc.toLowerCase()).toContain(term.toLowerCase());
		}
		for (const check of ["braille", "box", "OSC 52", "truecolor"]) {
			expect(doc.toLowerCase()).toContain(check.toLowerCase());
		}
	});
});

describe("CLI/TUI export artifact parity (P5 acceptance)", () => {
	it("cli export output matches the core exporter byte-for-byte", async () => {
		const preset = {
			id: "parity",
			name: "Parity Preset",
			model_path: "~/models/llm/qwen2.5-coder-32b.gguf",
			flags: {
				n_gpu_layers: 65,
				ctx_size: 32768,
				host: "127.0.0.1",
				port: 8080,
				slots: true,
				metrics: true,
			},
			env_vars: {},
			created_at: "2026-08-24T00:00:00Z",
			last_used: null,
		};
		const base = join(ROOT, `.tmp/exit-gate/${Date.now()}`);
		const dir = join(base, "config/llama-deck");
		mkdirSync(dir, { recursive: true });
		await Bun.write(
			`${dir}/presets.json`,
			JSON.stringify({ version: 2, presets: [preset] }),
		);
		const proc = Bun.spawnSync(
			[
				process.execPath,
				"src/cli.ts",
				"export",
				"parity",
				"--format",
				"systemd",
			],
			{
				env: {
					...process.env,
					XDG_CONFIG_HOME: `${base}/config`,
				},
			},
		);
		const cliOut = proc.stdout.toString();
		const core = await import("../src/core/preset-launch");
		// same input -> identical bytes whether invoked via CLI or TUI path
		expect(cliOut).toBe(core.exportPreset(preset as never, "systemd"));
		expect(cliOut).toContain("ExecStart=");
	});
});
