import { describe, expect, it } from "bun:test";
import { cycleFocus, TAB_COUNT } from "../../src/ui/logic/shell-state";

describe("production shell tab contract", () => {
	it("exposes exactly the four specification tabs", () => {
		expect(TAB_COUNT).toBe(4);
	});

	it("cycles only the two visible shell focus regions", () => {
		expect(cycleFocus(2, 0, true)).toBe(1);
		expect(cycleFocus(2, 1, true)).toBe(0);
		expect(cycleFocus(2, 0, false)).toBe(1);
	});
});
