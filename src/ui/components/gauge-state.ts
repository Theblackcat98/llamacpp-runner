import type { Theme } from "../themes";

const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/**
 * Horizontal eighth-block partials, index = filled eighths of one cell.
 * Each glyph is exactly one monospace column (spec §8).
 */
const PARTIALS = [
	"",
	"\u{258F}",
	"\u{258E}",
	"\u{258D}",
	"\u{258C}",
	"\u{258B}",
	"\u{258A}",
	"\u{2589}",
];

export function gaugeBar(fraction: number, width: number): string {
	if (width <= 0) return "";
	const clamped = Math.min(Math.max(fraction, 0), 1);
	const units = clamped * width;
	let full = Math.floor(units);
	let partial = Math.round((units - full) * 8);
	if (partial === 8) {
		full += 1;
		partial = 0;
	}
	return (
		"█".repeat(full) +
		(PARTIALS[partial] ?? "") +
		"░".repeat(width - full - (partial > 0 ? 1 : 0))
	);
}

/**
 * btop-style semantic fill color for pressure gauges (VRAM, KV cache).
 * Documented thresholds: below 70% the resource is comfortable (success),
 * 70–90% is getting tight (warn), at/above 90% is critical (error).
 */
export function gaugeFillColor(value: number, theme: Theme): string {
	if (value >= 0.9) return theme.error;
	if (value >= 0.7) return theme.warn;
	return theme.success;
}

export function sparkline(values: number[], levels = BLOCKS.length): string {
	const palette = BLOCKS.slice(0, Math.min(Math.max(levels, 1), BLOCKS.length));
	return values
		.map((v) => {
			const clamped = Math.min(Math.max(v, 0), 1);
			const idx = Math.round(clamped * (palette.length - 1));
			return palette[idx] ?? "";
		})
		.join("");
}
