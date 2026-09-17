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
		// #62: honest reporting — the write proves SEND, not delivery.
		expect(result.method).toBe("osc52-unconfirmed");
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
				xclip: () => {
					calls.push("xclip");
					return false;
				},
				xsel: () => {
					calls.push("xsel");
					return false;
				},
				wl_copy: () => {
					calls.push("wl_copy");
					return false;
				},
				pbcopy: () => {
					calls.push("pbcopy");
					return true;
				},
			},
			whichFn: () => null,
		});
		expect(result.method).toBe("pbcopy");
		expect(calls).toEqual(["xclip", "xsel", "wl_copy", "pbcopy"]);
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

describe("honest OSC 52 reporting (#62)", () => {
	it("reports osc52-unconfirmed — sent, never verified", () => {
		let written = "";
		const result = copyToClipboard({
			text: "hello",
			writeFn: (s) => {
				written += s;
			},
		});
		expect(result.method).toBe("osc52-unconfirmed");
		expect(written).toContain("52;c;");
	});

	it("an allowlisted tool skips OSC 52 entirely", () => {
		let written = "";
		const result = copyToClipboard({
			text: "hello",
			clipboardEnv: "xclip",
			writeFn: (s) => {
				written += s;
			},
			runners: { xclip: () => true },
		});
		expect(written).toBe("");
		expect(result.method).toBe("xclip");
	});

	it("opt-out without allowlist walks the fallback chain", () => {
		let written = "";
		const order: string[] = [];
		const result = copyToClipboard({
			text: "hello",
			clipboardEnv: "local",
			writeFn: (s) => {
				written += s;
			},
			// Hermetic: no real tools on this machine may answer.
			whichFn: () => null,
			runners: {
				xclip: () => {
					order.push("xclip");
					return false;
				},
				pbcopy: () => {
					order.push("pbcopy");
					return true;
				},
			},
		});
		expect(written).toBe("");
		// xclip is tried (and refuses), then pbcopy succeeds.
		expect(order).toEqual(["xclip", "pbcopy"]);
		expect(result.method).toBe("pbcopy");
	});

	it("an allowlisted missing tool fails honestly", () => {
		const result = copyToClipboard({
			text: "hello",
			clipboardEnv: "wl_copy",
			writeFn: () => {},
			whichFn: () => null,
		});
		expect(result.method).toBe("failed");
		if (result.method === "failed") {
			expect(result.notice).toContain("LLAMA_DECK_CLIPBOARD=wl_copy");
		}
	});
});
