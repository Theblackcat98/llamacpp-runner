import { describe, expect, it } from "bun:test";
import {
	type IconKind,
	detectIconSet,
	iconFor,
	ICON_KINDS,
} from "../../src/ui/glyphs";

describe("glyph detection (#51)", () => {
	it("defaults to ascii (tofu-safe) with a bare environment", () => {
		expect(detectIconSet({})).toBe("ascii");
	});

	it("honors the explicit LLAMA_DECK_ICONS override", () => {
		expect(detectIconSet({ LLAMA_DECK_ICONS: "nerd" })).toBe("nerd");
		expect(detectIconSet({ LLAMA_DECK_ICONS: "ascii" })).toBe("ascii");
		// Unknown values fall back to ascii, never tofu.
		expect(detectIconSet({ LLAMA_DECK_ICONS: "emoji" })).toBe("ascii");
	});

	it("treats NERD_FONT / USE_NERD_FONT flags as opt-in", () => {
		expect(detectIconSet({ NERD_FONT: "1" })).toBe("nerd");
		expect(detectIconSet({ USE_NERD_FONT: "true" })).toBe("nerd");
		expect(detectIconSet({ NERD_FONT: "0" })).toBe("ascii");
	});

	it("explicit override wins over NERD_FONT flags", () => {
		expect(detectIconSet({ LLAMA_DECK_ICONS: "ascii", NERD_FONT: "1" })).toBe(
			"ascii",
		);
	});
});

describe("icon mapping (#51)", () => {
	const nerdGlyphs = new Map<IconKind, string>();
	const asciiGlyphs = new Map<IconKind, string>();

	for (const kind of ICON_KINDS) {
		const nerd = iconFor(kind, "nerd");
		const ascii = iconFor(kind, "ascii");
		nerdGlyphs.set(kind, nerd);
		asciiGlyphs.set(kind, ascii);

		it(`"${kind}" has a defined glyph in both sets`, () => {
			expect(typeof nerd).toBe("string");
			expect(typeof ascii).toBe("string");
		});

		it(`"${kind}" glyphs occupy at most 1 column (spec §8, no wide/tofu glyphs)`, () => {
			expect(Bun.stringWidth(nerd)).toBeLessThanOrEqual(1);
			expect(Bun.stringWidth(ascii)).toBeLessThanOrEqual(1);
		});

		it(`"${kind}" ascii fallback is never a PUA or emoji codepoint`, () => {
			if (ascii === "") return;
			const cp = ascii.codePointAt(0) ?? 0;
			// PUA (incl. Nerd Font) and emoji ranges are the tofu sources.
			expect(cp >= 0xe000 && cp <= 0xf8ff).toBe(false);
			expect(cp >= 0x1f300 && cp <= 0x1faff).toBe(false);
		});
	}

	it("tab icons are decorative: ascii tabs carry no glyph", () => {
		for (const kind of [
			"tab-explorer",
			"tab-config",
			"tab-telemetry",
			"tab-presets",
		] as const) {
			expect(iconFor(kind, "ascii")).toBe("");
		}
	});

	it("nerd set actually differs from ascii (icons exist)", () => {
		const differing = ICON_KINDS.filter(
			(k) => nerdGlyphs.get(k) !== asciiGlyphs.get(k),
		);
		// Tab icons + file/empty/badge icons differ; decorative-empty kinds may match.
		expect(differing.length).toBeGreaterThan(4);
	});

	it("nerd glyphs are Nerd Font PUA codepoints, never emoji", () => {
		for (const [, glyph] of nerdGlyphs) {
			if (glyph === "") continue;
			const cp = glyph.codePointAt(0) ?? 0;
			// Nerd Font patched sets live in the Private Use Area.
			expect(cp >= 0xe000 && cp <= 0xf8ff).toBe(true);
		}
	});
});
