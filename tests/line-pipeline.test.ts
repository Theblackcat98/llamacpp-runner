import { describe, expect, it } from "bun:test";
import { LineAssembler } from "../src/core/process/line-assembler";
import { RingBuffer } from "../src/core/process/ring-buffer";

describe("line assembler (§2.5)", () => {
	it("splits on \\n", () => {
		const asm = new LineAssembler();
		expect(asm.push("a\nb\n")).toEqual(["a", "b"]);
	});

	it("treats \\r\\n as one terminator without altering content", () => {
		const asm = new LineAssembler();
		expect(asm.push("a\r\nb\r\n")).toEqual(["a", "b"]);
	});

	it("collapses \\r progress overwrites into the final visual line (§2.5)", () => {
		const asm = new LineAssembler();
		const out = [
			...asm.push("load 10%\r"),
			...asm.push("load 50%\r"),
			...asm.push("done\n"),
		];
		expect(out).toEqual(["done 50%"]);
	});

	it("shorter overwrite keeps the tail, like a real terminal", () => {
		const asm = new LineAssembler();
		expect(asm.push("abcdef\rcd\n")).toEqual(["cdcdef"]);
	});

	it("consecutive \\r without text stays on the same line", () => {
		const asm = new LineAssembler();
		expect(asm.push("ab\r\rx\n")).toEqual(["xb"]);
	});

	it("handles \\r at end of one chunk followed by \\n in the next", () => {
		const asm = new LineAssembler();
		const out = [...asm.push("a\r"), ...asm.push("\n")];
		expect(out).toEqual(["a"]);
	});

	it("preserves ANSI escape sequences verbatim", () => {
		const asm = new LineAssembler();
		expect(asm.push("\x1b[32mok\x1b[0m\n")).toEqual(["\x1b[32mok\x1b[0m"]);
	});

	it("flush emits an unterminated trailing line once", () => {
		const asm = new LineAssembler();
		asm.push("partial");
		expect(asm.flush()).toEqual(["partial"]);
		expect(asm.flush()).toEqual([]);
	});

	it("flush emits visible tail when stream ended mid-overwrite", () => {
		const asm = new LineAssembler();
		asm.push("load 90%\r");
		expect(asm.flush()).toEqual(["load 90%"]);
	});
});

describe("ring buffer (P1-NFR-02)", () => {
	it("evicts oldest beyond capacity", () => {
		const rb = new RingBuffer<number>(3);
		for (const n of [1, 2, 3, 4]) rb.push(n);
		expect(rb.snapshot()).toEqual([2, 3, 4]);
	});

	it("holds up to 10000 lines", () => {
		const rb = new RingBuffer<string>(10_000);
		for (let i = 0; i < 12_000; i++) rb.push(`l${i}`);
		expect(rb.size).toBe(10_000);
		expect(rb.snapshot()[0]).toBe("l2000");
	});

	it("snapshot is an independent copy", () => {
		const rb = new RingBuffer<number>(2);
		rb.push(1);
		const snap = rb.snapshot();
		rb.push(2);
		expect(snap).toEqual([1]);
		expect(rb.size).toBe(2);
	});

	it("clear empties the buffer", () => {
		const rb = new RingBuffer<number>(2);
		rb.push(1);
		rb.clear();
		expect(rb.size).toBe(0);
		expect(rb.snapshot()).toEqual([]);
	});
});
