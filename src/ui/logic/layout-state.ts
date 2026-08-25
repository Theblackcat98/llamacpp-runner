export const MIN_WIDTH = 100;
export const MIN_HEIGHT = 30;

/** Below 100x30 the shell must degrade to a single-column resize hint (§7). */
export function isDegraded(width: number, height: number): boolean {
	return width < MIN_WIDTH || height < MIN_HEIGHT;
}

export interface Dims {
	width: number;
	height: number;
}

/**
 * Debounced relayout (P5-FR-14): during resize churn only the final
 * dimensions commit, so overlapping renders never hit the screen.
 * Pure state machine — the shell drives it with a settle timer.
 */
export interface RelayoutState {
	committed: Dims;
	pending: { dims: Dims; at: number } | null;
}

export function createRelayout(width: number, height: number): RelayoutState {
	return { committed: { width, height }, pending: null };
}

export function beginResize(
	state: RelayoutState,
	dims: Dims,
	atMs: number,
): RelayoutState {
	if (
		dims.width === state.committed.width &&
		dims.height === state.committed.height
	) {
		return { ...state, pending: null };
	}
	return { ...state, pending: { dims, at: atMs } };
}

/** Commit pending dimensions once `debounceMs` of quiet time has passed. */
export function settleDue(
	state: RelayoutState,
	nowMs: number,
	debounceMs: number,
): { state: RelayoutState; dims: Dims | null } {
	const pending = state.pending;
	if (!pending) return { state, dims: null };
	if (nowMs - pending.at < debounceMs) return { state, dims: null };
	return {
		state: { committed: pending.dims, pending: null },
		dims: pending.dims,
	};
}
