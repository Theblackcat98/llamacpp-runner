import { describe, expect, it } from "bun:test";
import {
	gaugeBar,
	gaugeFillColor,
	sparkline,
} from "../src/ui/components/gauge-state";
import { TOKYO_NIGHT } from "../src/ui/themes";

describe("gauge widget (P2-FR-10)", () => {
	it("renders labeled block bar with clamped value", () => {
		expect(gaugeBar(0.5, 10)).toBe("█████░░░░░");
		expect(gaugeBar(1.5, 4)).toBe("████");
		expect(gaugeBar(-1, 4)).toBe("░░░░");
		expect(gaugeBar(0.9999, 8)).toBe("████████");
		expect(gaugeBar(0.25, 8)).toBe("██░░░░░░");
	});

	it("renders eighth-block fractional fills (#52)", () => {
		// 1.5 cells -> full + 4/8 partial; every partial is 1 column wide.
		expect(gaugeBar(0.5, 3)).toBe("\u{2588}\u{258C}\u{2591}");
		expect(gaugeBar(0.125, 4)).toBe("\u{258C}\u{2591}\u{2591}\u{2591}");
		expect(gaugeBar(0.0625, 4)).toBe("\u{258E}\u{2591}\u{2591}\u{2591}");
		expect(gaugeBar(0.9375, 4)).toBe("\u{2588}\u{2588}\u{2588}\u{258A}");
		expect(gaugeBar(0, 4)).toBe("\u{2591}\u{2591}\u{2591}\u{2591}");
		for (const [bar, width] of [
			["\u{2588}\u{258C}\u{2591}", 3],
			["\u{258C}\u{2591}\u{2591}\u{2591}", 4],
			["\u{258E}\u{2591}\u{2591}\u{2591}", 4],
			["\u{2588}\u{2588}\u{2588}\u{258A}", 4],
		] as const) {
			expect(Bun.stringWidth(bar)).toBe(width);
		}
	});

	it("shifts fill color through semantic thresholds (#52)", () => {
		expect(gaugeFillColor(0, TOKYO_NIGHT)).toBe(TOKYO_NIGHT.success);
		expect(gaugeFillColor(0.699, TOKYO_NIGHT)).toBe(TOKYO_NIGHT.success);
		expect(gaugeFillColor(0.7, TOKYO_NIGHT)).toBe(TOKYO_NIGHT.warn);
		expect(gaugeFillColor(0.899, TOKYO_NIGHT)).toBe(TOKYO_NIGHT.warn);
		expect(gaugeFillColor(0.9, TOKYO_NIGHT)).toBe(TOKYO_NIGHT.error);
		expect(gaugeFillColor(1.5, TOKYO_NIGHT)).toBe(TOKYO_NIGHT.error);
	});

	it("sparkline maps values onto the block spectrum", () => {
		expect(sparkline([0, 0.25, 0.5, 1])).toBe("▁▃▅█");
		expect(sparkline([])).toBe("");
		expect(sparkline([0.6, 0.2], 4)).toBe("▃▂");
	});
});
