/**
 * Sparkline history (§2.4, P5-FR-05): block-fill glyphs ▁▂▃▅▇ over capped
 * history rings (P5-NFR-04 — no unbounded growth).
 */
import { RingBuffer } from "../process/ring-buffer";

export const SPARK_GLYPHS = ["▁", "▂", "▃", "▅", "▇"] as const;

export class HistoryRing<T> extends RingBuffer<T> {}

/**
 * Render values as a sparkline. Values are normalized across the sample's own
 * min..max; a flat series renders mid-band. `width` keeps only the most
 * recent samples.
 */
export function sparkline(values: number[], width?: number): string {
	const slice = width !== undefined ? values.slice(-width) : values;
	if (slice.length === 0) return "";
	const min = Math.min(...slice);
	const max = Math.max(...slice);
	return slice
		.map((v) => {
			if (max === min) return SPARK_GLYPHS[Math.floor(SPARK_GLYPHS.length / 2)];
			const norm = (v - min) / (max - min);
			return SPARK_GLYPHS[
				Math.min(
					SPARK_GLYPHS.length - 1,
					Math.floor(norm * SPARK_GLYPHS.length),
				)
			];
		})
		.join("");
}
