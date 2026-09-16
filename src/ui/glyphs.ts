/**
 * Nerd Font icons with ASCII fallbacks (#51).
 *
 * Tofu boxes (missing-glyph rectangles) are the instant "amateur" signal, so
 * detection is conservative: Nerd Font glyphs render only on explicit opt-in.
 * There is no reliable cross-terminal query for font support, so "auto"
 * defaults to the ASCII set and never guesses from TERM_PROGRAM.
 *
 * Detection order:
 * 1. `LLAMA_DECK_ICONS=nerd|ascii` — explicit override, always wins.
 * 2. `NERD_FONT=1` / `USE_NERD_FONT=1` — common opt-in flags.
 * 3. Otherwise `ascii` (tofu-safe default).
 *
 * Every glyph in both sets occupies at most one monospace column (spec §8):
 * Nerd Font codepoints come from the Private Use Area (U+E000–U+F8FF) and
 * ASCII fallbacks are printable 7-bit characters. Tab icons are decorative —
 * the tab bar already carries `[1]`–`[4]` numeric badges, so the ASCII set
 * omits them rather than adding noise.
 */

export type IconSet = "nerd" | "ascii";

export type IconKind =
	| "tab-explorer"
	| "tab-config"
	| "tab-telemetry"
	| "tab-presets"
	| "file-model"
	| "file-corrupt"
	| "file-incomplete"
	| "empty-welcome"
	| "empty-none"
	| "badge-ok"
	| "badge-warn"
	| "badge-error";

export const ICON_KINDS: readonly IconKind[] = [
	"tab-explorer",
	"tab-config",
	"tab-telemetry",
	"tab-presets",
	"file-model",
	"file-corrupt",
	"file-incomplete",
	"empty-welcome",
	"empty-none",
	"badge-ok",
	"badge-warn",
	"badge-error",
] as const;

/** Nerd Font (Font Awesome PUA) glyphs — 1 column each in patched fonts. */
const NERD: Record<IconKind, string> = {
	"tab-explorer": "\u{F07B}", // fa-folder
	"tab-config": "\u{F135}", // fa-rocket
	"tab-telemetry": "\u{F201}", // fa-line-chart
	"tab-presets": "\u{F013}", // fa-cog
	"file-model": "\u{F1C0}", // fa-database
	"file-corrupt": "\u{F071}", // fa-exclamation-triangle
	"file-incomplete": "\u{F059}", // fa-question-circle
	"empty-welcome": "\u{F07B}", // fa-folder
	"empty-none": "\u{F002}", // fa-search
	"badge-ok": "\u{F00C}", // fa-check
	"badge-warn": "\u{F071}", // fa-exclamation-triangle
	"badge-error": "\u{F00D}", // fa-times
};

/** ASCII fallbacks — printable 7-bit only, never tofu. */
const ASCII: Record<IconKind, string> = {
	"tab-explorer": "",
	"tab-config": "",
	"tab-telemetry": "",
	"tab-presets": "",
	"file-model": "*",
	"file-corrupt": "!",
	"file-incomplete": "~",
	"empty-welcome": "",
	"empty-none": "",
	"badge-ok": "●",
	"badge-warn": "▲",
	"badge-error": "✖",
};

export function iconFor(kind: IconKind, set: IconSet): string {
	return set === "nerd" ? NERD[kind] : ASCII[kind];
}

function isTruthyFlag(value: string | undefined): boolean {
	if (value === undefined) return false;
	return ["1", "true", "yes"].includes(value.trim().toLowerCase());
}

/**
 * Resolve which icon set to render. Pure over the provided env mapping so it
 * is unit-testable; callers pass `process.env`.
 */
export function detectIconSet(
	env: Record<string, string | undefined>,
): IconSet {
	const override = (env.LLAMA_DECK_ICONS ?? "").trim().toLowerCase();
	if (override === "nerd") return "nerd";
	if (override === "ascii") return "ascii";
	// Unknown override values fall through to the safe default.
	if (isTruthyFlag(env.NERD_FONT) || isTruthyFlag(env.USE_NERD_FONT)) {
		return "nerd";
	}
	return "ascii";
}
