import { describe, expect, it } from "bun:test";
import {
	type CopyResult,
	copyToClipboard,
	osc52Sequence,
} from "../src/core/export/clipboard";

describe("clipboard (P4-FR-16a, D6)", () => {
	it("OSC 52 sequence is base64 payload with BEL terminator", () => {
		const seq = osc52Sequence("hello");
		expect(seq).toBe(
			`\u001b]52;c;${Buffer.from("hello").toString("base64")}\u0007`,
		);
	});

	it("primary path writes OSC 52 to the injected terminal writer", () => {
		const written: string[] = [];
		const result: CopyResult = copyToClipboard({
			text: "llama-server -m x.gguf",
			writeFn: (s) => written.push(s),
			runners: {},
		});
		expect(result.method).toBe("osc52");
		expect(written.length).toBe(1);
	});

	it("falls back to xclip when OSC write throws", () => {
		const calls: string[] = [];
		const result = copyToClipboard({
			text: "cmd",
			writeFn: () => {
				throw new Error("not a tty");
			},
			runners: {
				xclip: (text) => {
					calls.push(`xclip:${text}`);
					return true;
				},
				xsel: (text) => {
					calls.push(`xsel:${text}`);
					return true;
				},
			},
		});
		expect(result.method).toBe("xclip");
		expect(calls).toEqual(["xclip:cmd"]);
	});

	it("walks the whole fallback chain in order (D6)", () => {
		const calls: string[] = [];
		const result = copyToClipboard({
			text: "cmd",
			writeFn: () => {
				throw new Error("no tty");
			},
			runners: {
				wl_copy: () => false,
				pbcopy: () => {
					calls.push("pbcopy");
					return true;
				},
			},
		});
		expect(result.method).toBe("pbcopy");
	});

	it("graceful notice on total failure — never throws", () => {
		const result: CopyResult = copyToClipboard({
			text: "cmd",
			writeFn: () => {
				throw new Error("no tty");
			},
			runners: {},
			whichFn: () => null,
		});
		expect(result.method).toBe("failed");
		if (result.method === "failed") {
			expect(result.notice).toContain("clipboard");
		}
	});
});
