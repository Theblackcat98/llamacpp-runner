export interface ChipGroupState {
	chips: string[];
	cursor: number;
	activeIndex: number;
	/** Digits typed for arbitrary numeric entry (audit #5); "" when idle. */
	typed: string;
	/** Numeric value committed via typed entry, when it matches no chip. */
	customValue: number | null;
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
	return {
		chips: options.chips,
		cursor: activeIndex,
		activeIndex,
		typed: "",
		customValue: null,
	};
}

export function applyChipKey(
	state: ChipGroupState,
	keyName: string,
): ChipGroupState {
	const n = state.chips.length;
	if (n === 0) return state;
	const cursor = Math.min(state.cursor, n - 1);
	// Arbitrary numeric entry: digits accumulate; Enter/Space commits the
	// typed number (selecting the matching chip, or a custom value when no
	// chip matches); Backspace edits; Escape cancels the pending entry.
	if (/^[0-9]$/.test(keyName)) {
		return { ...state, typed: (state.typed + keyName).slice(0, 7) };
	}
	if (keyName === "backspace" && state.typed.length > 0) {
		return { ...state, typed: state.typed.slice(0, -1) };
	}
	if (keyName === "escape" && state.typed.length > 0) {
		return { ...state, typed: "" };
	}
	switch (keyName) {
		case "left":
			return { ...state, cursor: (cursor - 1 + n) % n, typed: "" };
		case "right":
			return { ...state, cursor: (cursor + 1) % n, typed: "" };
		case "return":
		case "enter":
		case "space": {
			if (state.typed.length > 0) {
				const value = Number.parseInt(state.typed, 10);
				const match = state.chips.findIndex((c) => Number(c) === value);
				if (match >= 0) {
					return {
						...state,
						activeIndex: match,
						cursor: match,
						typed: "",
						customValue: null,
					};
				}
				return {
					...state,
					activeIndex: cursor,
					typed: "",
					customValue: value,
				};
			}
			return { ...state, activeIndex: cursor, customValue: null };
		}
		default:
			return state;
	}
}
