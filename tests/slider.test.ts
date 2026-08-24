import { describe, expect, it } from "bun:test";
import {
	applySliderKey,
	createSliderState,
	renderReadout,
	renderTrack,
} from "../src/ui/components/slider-state";

describe("slider state (P2-FR-02)", () => {
	it("left/right step by one and clamp", () => {
		let s = createSliderState({ min: 0, max: 10, value: 5 });
		expect(applySliderKey(s, "right").value).toBe(6);
		expect(applySliderKey(s, "left").value).toBe(4);
		s = createSliderState({ min: 0, max: 10, value: 0 });
		expect(applySliderKey(s, "left").value).toBe(0);
		s = createSliderState({ min: 0, max: 10, value: 10 });
		expect(applySliderKey(s, "right").value).toBe(10);
	});

	it("shift+left/right step by ten and clamp", () => {
		let s = createSliderState({ min: 0, max: 25, value: 5 });
		s = applySliderKey(s, "right", { shift: true });
		expect(s.value).toBe(15);
		s = applySliderKey(s, "left", { shift: true });
		expect(s.value).toBe(5);
		s = applySliderKey(s, "left", { shift: true });
		expect(s.value).toBe(0);
	});

	it("home/end jump to min/max", () => {
		const s = createSliderState({ min: 2, max: 8, value: 5 });
		expect(applySliderKey(s, "home").value).toBe(2);
		expect(applySliderKey(s, "end").value).toBe(8);
	});

	it("ignores unrelated keys", () => {
		const s = createSliderState({ min: 0, max: 9, value: 3 });
		expect(applySliderKey(s, "x").value).toBe(3);
	});

	it("renders a filled track with a numeric readout", () => {
		expect(renderTrack(5, 0, 10, 10)).toBe("█████░░░░░");
		expect(renderReadout(5, 0, 10)).toBe("5/10");
		expect(renderTrack(0, 0, 10, 4)).toBe("░░░░");
		expect(renderTrack(10, 0, 10, 4)).toBe("████");
	});
});
