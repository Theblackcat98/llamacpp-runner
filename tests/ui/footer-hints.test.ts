import { describe, expect, it } from "bun:test";
import { footerHintLine } from "../../src/ui/footer-hints";

describe("footerHintLine (#48)", () => {
	it("is contextual per tab", () => {
		expect(footerHintLine(0, 120)).toContain("[m]");
		expect(footerHintLine(1, 120)).toContain("[Ctrl+S]");
		expect(footerHintLine(2, 120)).toContain("[t]");
		expect(footerHintLine(3, 120)).toContain("[l]");
		expect(footerHintLine(0, 120)).not.toContain("[Ctrl+S]");
	});

	it("never exceeds the terminal width", () => {
		for (const tab of [0, 1, 2, 3]) {
			for (const width of [20, 40, 80, 120]) {
				const line = footerHintLine(tab, width);
				expect(line.length).toBeLessThanOrEqual(width);
			}
		}
	});

	it("keeps at least the first hint at tiny widths", () => {
		expect(footerHintLine(0, 20).length).toBeGreaterThan(0);
	});

	it("a notice overrides the hints and is clipped to width", () => {
		const notice = "press [q] again to quit";
		expect(footerHintLine(0, 120, notice)).toBe(notice);
		expect(footerHintLine(0, 10, notice)).toBe(notice.slice(0, 10));
	});

	it("falls back to tab 0 for unknown tabs", () => {
		expect(footerHintLine(99, 120)).toBe(footerHintLine(0, 120));
	});
});
