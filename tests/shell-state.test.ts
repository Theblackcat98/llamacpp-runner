import { describe, expect, it } from "bun:test";
import {
	cycleFocus,
	isQuitKey,
	nextTab,
	TAB_COUNT,
} from "../src/ui/logic/shell-state";

describe("shell state logic (P1-FR-02,03)", () => {
	it("cycles tabs forward with wraparound", () => {
		expect(nextTab(0)).toBe(1);
		expect(nextTab(TAB_COUNT - 1)).toBe(0);
	});

	it("cycles focus forward and backward among panes", () => {
		expect(cycleFocus(4, 0, true)).toBe(1);
		expect(cycleFocus(4, 3, true)).toBe(0);
		expect(cycleFocus(4, 2, false)).toBe(1);
		expect(cycleFocus(4, 0, false)).toBe(3);
	});

	it("q quits in normal mode", () => {
		expect(isQuitKey({ name: "q" })).toBe(true);
		expect(isQuitKey({ name: "Q", shift: true })).toBe(true);
	});

	it("ctrl+c quits regardless of name", () => {
		expect(isQuitKey({ name: "c", ctrl: true })).toBe(true);
	});

	it("other keys do not quit", () => {
		expect(isQuitKey({ name: "x" })).toBe(false);
		expect(isQuitKey({ name: "j", ctrl: true })).toBe(false);
	});
});
