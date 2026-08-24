import { describe, expect, it } from "bun:test";
import {
	applyScrollKey,
	createScrollPaneState,
	growContent,
	isFollowing,
	visibleWindow,
} from "../src/ui/components/scroll-pane-state";

describe("scroll pane state (P2-FR-07)", () => {
	it("follows bottom by default and shows last viewport", () => {
		const s = createScrollPaneState({ contentLines: 10, viewport: 3 });
		expect(isFollowing(s)).toBe(true);
		expect(visibleWindow(s)).toEqual([7, 8, 9]);
	});

	it("pauses on upward scroll and keeps position", () => {
		let s = createScrollPaneState({ contentLines: 50, viewport: 3 });
		s = applyScrollKey(s, "up", 50);
		const paused = visibleWindow(s);
		expect(isFollowing(s)).toBe(false);
		s = applyScrollKey(s, "", 55);
		expect(visibleWindow(s)).toEqual(paused);
	});

	it("G/End resume autoscroll", () => {
		let s = createScrollPaneState({ contentLines: 0, viewport: 3 });
		s = applyScrollKey(s, "up", 50);
		s = applyScrollKey(s, "G", 52);
		expect(isFollowing(s)).toBe(true);
	});

	it("PgUp/PgDn move by viewport page", () => {
		let s = createScrollPaneState({ contentLines: 100, viewport: 5 });
		s = applyScrollKey(s, "pageup", 100);
		expect(visibleWindow(s)).toEqual([90, 91, 92, 93, 94]);
		s = applyScrollKey(s, "pagedown", 100);
		expect(visibleWindow(s)).toEqual([95, 96, 97, 98, 99]);
	});

	it("new content grows the window when following, keeps position when paused", () => {
		let s = createScrollPaneState({ contentLines: 10, viewport: 3 });
		s = growContent(s, 12);
		expect(visibleWindow(s)).toEqual([9, 10, 11]);
		s = applyScrollKey(s, "up", 12);
		const paused = visibleWindow(s);
		s = growContent(s, 20);
		expect(visibleWindow(s)).toEqual(paused);
	});
});
