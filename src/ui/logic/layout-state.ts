export const MIN_WIDTH = 100;
export const MIN_HEIGHT = 30;

/** Below 100x30 the shell must degrade to a single-column resize hint (§7). */
export function isDegraded(width: number, height: number): boolean {
	return width < MIN_WIDTH || height < MIN_HEIGHT;
}
