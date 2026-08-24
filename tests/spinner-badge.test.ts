import { describe, expect, it } from "bun:test";
import {
	badgeGlyph,
	createBadgeState,
	tick,
} from "../src/ui/components/badge-state";
import {
	SPINNER_ASCII,
	SPINNER_BRAILLE,
	SPINNER_QUADRANT,
	spinnerFrame,
} from "../src/ui/components/spinner-state";

describe("spinner (P2-FR-11, D8)", () => {
	it("cycles frames within its glyph set and wraps", () => {
		expect(spinnerFrame(SPINNER_BRAILLE, 0)).toBe("⠋");
		expect(spinnerFrame(SPINNER_BRAILLE, 1)).toBe("⠙");
		expect(spinnerFrame(SPINNER_BRAILLE, SPINNER_BRAILLE.length)).toBe("⠋");
		expect(SPINNER_QUADRANT.length).toBeGreaterThan(0);
		expect(SPINNER_ASCII).toEqual(["|", "/", "-", "\\"]);
	});

	it("contains no emoji glyphs (D8)", () => {
		for (const set of [SPINNER_BRAILLE, SPINNER_QUADRANT, ...SPINNER_ASCII]) {
			expect(
				Array.from(set).every((ch) => (ch.codePointAt(0) ?? 0) < 0x1f000),
			).toBe(true);
		}
	});
});

describe("badge (P2-FR-12)", () => {
	it("maps status vocabulary to glyphs", () => {
		expect(badgeGlyph(createBadgeState("ok"))).toBe("●");
		expect(badgeGlyph(createBadgeState("warn"))).toBe("▲");
		expect(badgeGlyph(createBadgeState("error"))).toBe("✖");
	});

	it("blink toggles on a tick", () => {
		const b = createBadgeState("ok", { blink: true });
		expect(b.visible).toBe(true);
		expect(tick(b).visible).toBe(false);
	});
});
