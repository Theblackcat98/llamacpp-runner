export interface CyclingSelectState {
	options: string[];
	index: number;
}

export interface CyclingSelectOptions {
	options: string[];
	index?: number;
}

export function createCyclingSelectState(
	options: CyclingSelectOptions,
): CyclingSelectState {
	const n = options.options.length;
	const index = n === 0 ? 0 : Math.min(Math.max(options.index ?? 0, 0), n - 1);
	return { options: options.options, index };
}

export function applySelectKey(
	state: CyclingSelectState,
	keyName: string,
): CyclingSelectState {
	const n = state.options.length;
	if (n === 0) return state;
	switch (keyName) {
		case "left":
			return { ...state, index: (state.index - 1 + n) % n };
		case "right":
			return { ...state, index: (state.index + 1) % n };
		default:
			return state;
	}
}
