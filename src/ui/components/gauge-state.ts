const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

export function gaugeBar(fraction: number, width: number): string {
	if (width <= 0) return "";
	const clamped = Math.min(Math.max(fraction, 0), 1);
	const filled = Math.round(clamped * width);
	return "█".repeat(filled) + "░".repeat(width - filled);
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
