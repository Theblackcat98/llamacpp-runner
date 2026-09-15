import { describe, expect, it } from "bun:test";
import { keyEventToInputKey } from "../src/ui/components/text-input";
import {
	applyKey,
	createTextInputState,
	type TextInputKey,
} from "../src/ui/components/text-input-state";

const k = {
	print: (ch: string): TextInputKey => ({ kind: "printable", ch }),
	back: { kind: "backspace" } as TextInputKey,
	del: { kind: "delete" } as TextInputKey,
	left: { kind: "left" } as TextInputKey,
	right: { kind: "right" } as TextInputKey,
	home: { kind: "home" } as TextInputKey,
	end: { kind: "end" } as TextInputKey,
	ins: { kind: "insert-toggle" } as TextInputKey,
};

function type(s: string, opts?: { maxLength?: number; numeric?: boolean }) {
	let st = createTextInputState(opts);
	for (const ch of s) st = applyKey(st, k.print(ch), opts);
	return st;
}

describe("text input state (P2-FR-01)", () => {
	it("inserts printable characters and advances the cursor", () => {
		expect(type("8080")).toEqual({
			buffer: "8080",
			cursor: 4,
			overwrite: false,
		});
	});

	it("backspace removes before cursor and moves cursor left", () => {
		let st = type("abc");
		st = applyKey(st, k.left, undefined);
		expect(applyKey(st, k.back, undefined).buffer).toBe("ac");
	});

	it("delete removes at cursor without moving", () => {
		let st = type("abc");
		st = applyKey(st, k.home, undefined);
		const after = applyKey(st, k.del, undefined);
		expect(after.buffer).toBe("bc");
		expect(after.cursor).toBe(0);
	});

	it("left/right/home/end move and clamp", () => {
		let st = type("abc");
		st = applyKey(st, k.home, undefined);
		expect(st.cursor).toBe(0);
		st = applyKey(applyKey(st, k.left, undefined), k.left, undefined);
		expect(st.cursor).toBe(0);
		st = applyKey(applyKey(st, k.end, undefined), k.right, undefined);
		expect(st.cursor).toBe(3);
	});

	it("inserts in the middle splicing the buffer", () => {
		let st = type("ac");
		st = applyKey(st, k.home, undefined);
		st = applyKey(st, k.right, undefined);
		st = applyKey(st, k.print("b"), undefined);
		expect(st.buffer).toBe("abc");
		expect(st.cursor).toBe(2);
	});

	it("overwrite replaces at cursor instead of splicing", () => {
		let st = type("xxxx");
		st = applyKey(st, k.home, undefined);
		st = applyKey(st, k.ins, undefined);
		expect(st.overwrite).toBe(true);
		st = applyKey(
			applyKey(st, k.print("a"), undefined),
			k.print("b"),
			undefined,
		);
		expect(st.buffer).toBe("abxx");
		expect(st.cursor).toBe(2);
	});

	it("maxLength caps growth", () => {
		const opts = { maxLength: 3 };
		expect(type("abcd", opts).buffer).toBe("abc");
	});

	it("overwrite at maxLength still replaces without growth", () => {
		const opts = { maxLength: 3 };
		let st = type("abc", opts);
		st = applyKey(st, k.home, undefined);
		st = applyKey(st, k.ins, undefined);
		st = applyKey(st, k.print("Z"), opts);
		expect(st.buffer).toBe("Zbc");
	});

	it("numeric mode rejects non-digits", () => {
		const opts = { numeric: true };
		expect(type("8a0.8-", opts).buffer).toBe("808");
	});

	it("reset replaces the buffer and moves the caret to the end (Phase 13)", () => {
		let st = type("abc");
		st = applyKey(st, k.home, undefined);
		st = applyKey(st, { kind: "reset", value: "xyz" }, undefined);
		expect(st).toEqual({ buffer: "xyz", cursor: 3, overwrite: false });
	});

	it("random key sequences never break invariants (property test)", () => {
		let seed = 0x2f6e2b1;
		const rnd = () => {
			seed = (seed * 1664525 + 1013904223) >>> 0;
			return seed / 0x100000000;
		};
		const alphabet = "abc89 .-x";
		for (let round = 0; round < 200; round++) {
			const opts = {
				maxLength: 1 + Math.floor(rnd() * 8),
				numeric: rnd() < 0.5,
			};
			let st = createTextInputState(opts);
			for (let step = 0; step < 60; step++) {
				const roll = rnd();
				let key: TextInputKey;
				if (roll < 0.5) {
					key = k.print(alphabet[Math.floor(rnd() * alphabet.length)] ?? "a");
				} else if (roll < 0.58) key = k.back;
				else if (roll < 0.66) key = k.del;
				else if (roll < 0.74) key = k.left;
				else if (roll < 0.82) key = k.right;
				else if (roll < 0.88) key = k.home;
				else if (roll < 0.94) key = k.end;
				else key = k.ins;
				st = applyKey(st, key, opts);
				expect(st.cursor).toBeGreaterThanOrEqual(0);
				expect(st.cursor).toBeLessThanOrEqual(st.buffer.length);
				expect(st.buffer.length).toBeLessThanOrEqual(opts.maxLength);
				if (opts.numeric) expect(st.buffer).toMatch(/^\d*$/);
			}
		}
	});

	describe("keyEventToInputKey (Issue #26)", () => {
		it("converts shifted letter keys to uppercase", () => {
			const res = keyEventToInputKey({ name: "a", shift: true });
			expect(res).toEqual({ kind: "printable", ch: "A" });
		});

		it("prefers sequence if available and printable", () => {
			const resLetter = keyEventToInputKey({
				name: "a",
				sequence: "A",
				shift: true,
			});
			expect(resLetter).toEqual({ kind: "printable", ch: "A" });

			const resSymbol = keyEventToInputKey({
				name: "1",
				sequence: "!",
				shift: true,
			});
			expect(resSymbol).toEqual({ kind: "printable", ch: "!" });
		});

		it("correctly handles path characters with capitals into buffer", () => {
			const path = "~/Models/LLMs/DeepSeek";
			let st = createTextInputState();
			for (const char of path) {
				const isUpper = char >= "A" && char <= "Z";
				const key = keyEventToInputKey({
					name: isUpper ? char.toLowerCase() : char,
					sequence: char,
					shift: isUpper,
				});
				expect(key).not.toBeNull();
				if (key) {
					st = applyKey(st, key);
				}
			}
			expect(st.buffer).toBe("~/Models/LLMs/DeepSeek");
		});
	});
});
