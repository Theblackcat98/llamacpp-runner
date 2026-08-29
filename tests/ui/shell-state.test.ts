import { describe, expect, it } from "bun:test";
import { TAB_COUNT } from "../../src/ui/logic/shell-state";

describe("production shell tab contract", () => {
	it("exposes exactly the four specification tabs", () => {
		expect(TAB_COUNT).toBe(4);
	});
});
