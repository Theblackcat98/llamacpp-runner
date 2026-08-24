export const SPINNER_BRAILLE = [
	"⠋",
	"⠙",
	"⠹",
	"⠸",
	"⠼",
	"⠴",
	"⠦",
	"⠧",
	"⠇",
	"⠏",
];

export const SPINNER_QUADRANT = ["▘", "▝", "▗", "▖", "▌", "▐", "▄", "▀"];

export const SPINNER_ASCII = ["|", "/", "-", "\\"];

export type SpinnerGlyphSet = string[];

export function spinnerFrame(set: SpinnerGlyphSet, tick: number): string {
	if (set.length === 0) return "";
	const i = ((tick % set.length) + set.length) % set.length;
	return set[i] ?? "";
}
