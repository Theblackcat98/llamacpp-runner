export interface ChipGroupState {
	chips: string[];
	cursor: number;
	activeIndex: number;
}

export interface ChipGroupOptions {
	chips: string[];
	activeIndex?: number;
}

export function createChipGroupState(
	options: ChipGroupOptions,
): ChipGroupState {
	const n = options.chips.length;
	const activeIndex =
		n === 0 ? 0 : Math.min(Math.max(options.activeIndex ?? 0, 0), n - 1);
	return { chips: options.chips, cursor: activeIndex, activeIndex };
}

export function applyChipKey(
	state: ChipGroupState,
	keyName: string,
): ChipGroupState {
	const n = state.chips.length;
	if (n === 0) return state;
	const cursor = Math.min(state.cursor, n - 1);
	switch (keyName) {
		case "left":
			return { ...state, cursor: (cursor - 1 + n) % n };
		case "right":
			return { ...state, cursor: (cursor + 1) % n };
		case "enter":
		case "space":
			return { ...state, activeIndex: cursor };
		default:
			return state;
	}
}
