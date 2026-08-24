import { describe, expect, it } from "bun:test";
import {
	applyChipKey,
	createChipGroupState,
} from "../src/ui/components/chip-group-state";

describe("chip group state (P2-FR-05)", () => {
	it("starts with exactly one active chip", () => {
		const s = createChipGroupState({
			chips: ["q4", "q5", "q8"],
			activeIndex: 0,
		});
		expect(s.chips.filter((_, i) => i === s.activeIndex)).toHaveLength(1);
	});

	it("left/right move the highlight with wraparound", () => {
		let s = createChipGroupState({ chips: ["a", "b", "c"], activeIndex: 0 });
		s = applyChipKey(s, "right");
		expect(s.cursor).toBe(1);
		s = applyChipKey(s, "right");
		s = applyChipKey(s, "right");
		expect(s.cursor).toBe(0);
		s = applyChipKey(s, "left");
		expect(s.cursor).toBe(2);
	});

	it("enter/space activates the highlighted chip — exactly one active", () => {
		let s = createChipGroupState({ chips: ["a", "b", "c"], activeIndex: 0 });
		s = applyChipKey(s, "right");
		s = applyChipKey(s, "enter");
		expect(s.activeIndex).toBe(1);
		expect(s.chips.filter((_, i) => i === s.activeIndex)).toHaveLength(1);
		s = applyChipKey(s, "space");
		expect(s.activeIndex).toBe(1);
	});

	it("clamps cursor when chips shrink", () => {
		const s = createChipGroupState({ chips: ["a", "b", "c"], activeIndex: 2 });
		const s2 = { ...s, cursor: 2, chips: ["a"] };
		const moved = applyChipKey(s2, "right");
		expect(moved.cursor).toBeLessThan(moved.chips.length);
	});
});
