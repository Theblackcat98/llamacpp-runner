import { describe, expect, it } from "bun:test";
import {
	formatCommand,
	formatEnvValue,
	shellQuote,
	systemdEnvironment,
	systemdQuote,
} from "../src/core/export/quote";

/** Phase 12: format-specific quoting for previews, .sh, and systemd. */
describe("shell quoting (POSIX)", () => {
	it("leaves safe words bare; ~ and % need no quoting in shell", () => {
		expect(shellQuote("llama-server")).toBe("llama-server");
		expect(shellQuote("100%")).toBe("100%");
		// `~` is not in the safe set: it is single-quoted like the goldens do.
		expect(shellQuote("~/models/qwen.gguf")).toBe("'~/models/qwen.gguf'");
	});

	it("single-quotes spaces, quotes, backslashes, newlines", () => {
		expect(shellQuote("a b")).toBe("'a b'");
		expect(shellQuote(`it's`)).toBe(`'it'\\''s'`);
		expect(shellQuote("a\\b")).toBe("'a\\b'");
		expect(shellQuote("line\nbreak")).toBe("'line\nbreak'");
	});

	it("formatCommand joins argv with shell quoting for cmd/sh", () => {
		const line = formatCommand(
			"llama-server",
			["-m", "my model.gguf", "--alias", "q'wen"],
			"shell",
		);
		expect(line).toBe(`llama-server -m 'my model.gguf' --alias 'q'\\''wen'`);
	});

	it("env values reuse the same formatter", () => {
		expect(formatEnvValue("0", "shell")).toBe("0");
		expect(formatEnvValue("/home/u/My Cache", "shell")).toBe(
			"'/home/u/My Cache'",
		);
	});
});

/** Phase 12: systemd has different escaping rules than POSIX sh. */
describe("systemd quoting", () => {
	it("leaves a conservative safe set bare", () => {
		expect(systemdQuote("llama-server")).toBe("llama-server");
		expect(systemdQuote("127.0.0.1")).toBe("127.0.0.1");
		expect(systemdQuote("/models/qwen.gguf")).toBe("/models/qwen.gguf");
	});

	it("double-quotes spaces and escapes quotes/backslashes", () => {
		expect(systemdQuote("/opt/my models/a.gguf")).toBe(
			'"/opt/my models/a.gguf"',
		);
		expect(systemdQuote('say "hi"')).toBe('"say \\"hi\\""');
		expect(systemdQuote("a\\b")).toBe('"a\\\\b"');
	});

	it("escapes % specifiers as %%", () => {
		expect(systemdQuote("100%")).toBe('"100%%"');
		expect(systemdQuote("cache_%i")).toBe('"cache_%%i"');
	});

	it("formatCommand produces a systemd ExecStart value", () => {
		const line = formatCommand(
			"llama-server",
			["-m", "/opt/my models/a.gguf", "-ngl", "65"],
			"systemd",
		);
		expect(line).toBe(`llama-server -m "/opt/my models/a.gguf" -ngl 65`);
	});

	it("Environment= wraps key=value once (no double quoting)", () => {
		expect(systemdEnvironment("CUDA_VISIBLE_DEVICES", "0")).toBe(
			'Environment="CUDA_VISIBLE_DEVICES=0"',
		);
		expect(systemdEnvironment("LLAMA_CACHE", "/home/u/My Cache")).toBe(
			'Environment="LLAMA_CACHE=/home/u/My Cache"',
		);
	});
});
