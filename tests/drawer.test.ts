import { describe, expect, it } from "bun:test";
import {
	appendLines,
	createDrawerState,
	isFollowing,
	pinToTail,
	scrollBy,
	setViewportHeight,
	visibleLines,
} from "../src/ui/logic/drawer-state";
import { parseSgr } from "../src/ui/logic/sgr";

describe("drawer state (P1-FR-10)", () => {
	it("follows tail by default and shows the last viewport worth of lines", () => {
		let s = createDrawerState(3);
		s = appendLines(s, ["a", "b", "c", "d", "e"]);
		expect(isFollowing(s)).toBe(true);
		expect(visibleLines(s)).toEqual(["c", "d", "e"]);
	});

	it("pauses on scroll-up and keeps receiving lines without moving view", () => {
		let s = createDrawerState(2);
		s = appendLines(s, ["1", "2", "3"]);
		s = scrollBy(s, -1);
		const paused = visibleLines(s);
		s = appendLines(s, ["4", "5"]);
		expect(visibleLines(s)).toEqual(paused);
		expect(isFollowing(s)).toBe(false);
	});

	it("resumes autoscroll via pinToTail (G/End)", () => {
		let s = createDrawerState(2);
		s = appendLines(s, ["1", "2", "3"]);
		s = scrollBy(s, -5);
		s = pinToTail(s);
		s = appendLines(s, ["4"]);
		expect(visibleLines(s)).toEqual(["3", "4"]);
	});

	it("scroll-up from follow shows the page above the tail", () => {
		let s = createDrawerState(2);
		s = appendLines(s, ["1", "2", "3", "4"]);
		s = scrollBy(s, -1);
		expect(visibleLines(s)).toEqual(["2", "3"]);
	});

	it("clamps scrollTop when lines are evicted (P1-NFR-02)", () => {
		let s = createDrawerState(2, 4);
		s = appendLines(s, ["1", "2", "3", "4", "5", "6"]);
		s = scrollBy(s, -100);
		s = appendLines(s, ["7", "8"]);
		expect(visibleLines(s).every((l) => l.length > 0)).toBe(true);
	});

	it("viewport height change clamps the scroll window", () => {
		let s = createDrawerState(2);
		s = appendLines(s, ["a", "b", "c"]);
		s = scrollBy(s, -10);
		s = setViewportHeight(s, 5);
		expect(visibleLines(s)).toEqual(["a", "b", "c"]);
	});
});

describe("SGR parser (P1-FR-09)", () => {
	it("splits colored spans", () => {
		const segs = parseSgr("\x1b[32mok\x1b[0m plain");
		expect(segs).toEqual([{ text: "ok", fg: "green" }, { text: " plain" }]);
	});

	it("handles bold and reset boundaries", () => {
		const segs = parseSgr("\x1b[1m\x1b[31mERR\x1b[0m after");
		expect(segs.some((s) => s.text === "ERR" && s.fg === "red" && s.bold)).toBe(
			true,
		);
		expect(segs.some((s) => s.text === " after" && !s.fg && !s.bold)).toBe(
			true,
		);
	});

	it("passes through unstyled text untouched", () => {
		expect(parseSgr("no escapes here")).toEqual([{ text: "no escapes here" }]);
	});

	it("returns one empty segment for empty input", () => {
		expect(parseSgr("")).toEqual([{ text: "" }]);
	});
});
