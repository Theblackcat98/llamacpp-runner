import { describe, expect, it } from "bun:test";
import {
	isDegraded,
	MIN_HEIGHT,
	MIN_WIDTH,
} from "../src/ui/logic/layout-state";

describe("degraded layout gate (§7)", () => {
	it("100x30 is the minimum supported viewport", () => {
		expect(MIN_WIDTH).toBe(100);
		expect(MIN_HEIGHT).toBe(30);
		expect(isDegraded(100, 30)).toBe(false);
	});

	it("below 100 columns degrades", () => {
		expect(isDegraded(99, 30)).toBe(true);
		expect(isDegraded(80, 40)).toBe(true);
	});

	it("below 30 rows degrades", () => {
		expect(isDegraded(120, 29)).toBe(true);
		expect(isDegraded(200, 10)).toBe(true);
	});

	it("above minimums stays normal", () => {
		expect(isDegraded(101, 31)).toBe(false);
		expect(isDegraded(240, 60)).toBe(false);
	});
});
