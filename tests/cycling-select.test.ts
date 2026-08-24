import { describe, expect, it } from "bun:test";
import {
	applySelectKey,
	createCyclingSelectState,
} from "../src/ui/components/cycling-select-state";

describe("cycling select state (P2-FR-04)", () => {
	const opts = ["mmap", "cuda", "vulkan"];

	it("left/right cycle with wraparound", () => {
		let s = createCyclingSelectState({ options: opts, index: 0 });
		expect(applySelectKey(s, "right").index).toBe(1);
		s = createCyclingSelectState({ options: opts, index: 2 });
		expect(applySelectKey(s, "right").index).toBe(0);
		expect(applySelectKey(s, "left").index).toBe(1);
		s = createCyclingSelectState({ options: opts, index: 0 });
		expect(applySelectKey(s, "left").index).toBe(2);
	});

	it("exposes the current option", () => {
		const s = createCyclingSelectState({ options: opts, index: 1 });
		expect(s.options[s.index]).toBe("cuda");
	});

	it("single option stays put", () => {
		const s = createCyclingSelectState({ options: ["only"], index: 0 });
		expect(applySelectKey(s, "right").index).toBe(0);
		expect(applySelectKey(s, "left").index).toBe(0);
	});
});
