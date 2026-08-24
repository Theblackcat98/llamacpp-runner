import { describe, expect, it } from "bun:test";
import { gaugeBar, sparkline } from "../src/ui/components/gauge-state";

describe("gauge widget (P2-FR-10)", () => {
	it("renders labeled block bar with clamped value", () => {
		expect(gaugeBar(0.5, 10)).toBe("█████░░░░░");
		expect(gaugeBar(1.5, 4)).toBe("████");
		expect(gaugeBar(-1, 4)).toBe("░░░░");
		expect(gaugeBar(0.9999, 8)).toBe("████████");
		expect(gaugeBar(0.25, 8)).toBe("██░░░░░░");
	});

	it("sparkline maps values onto the block spectrum", () => {
		expect(sparkline([0, 0.25, 0.5, 1])).toBe("▁▃▅█");
		expect(sparkline([])).toBe("");
		expect(sparkline([0.6, 0.2], 4)).toBe("▃▂");
	});
});
