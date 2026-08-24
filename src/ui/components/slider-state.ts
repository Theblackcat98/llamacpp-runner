export interface SliderState {
	value: number;
	min: number;
	max: number;
}

export interface SliderOptions {
	min: number;
	max: number;
	value?: number;
}

export interface SliderModifiers {
	shift?: boolean;
}

export function createSliderState(options: SliderOptions): SliderState {
	const { min, max } = options;
	const value = Math.min(Math.max(options.value ?? min, min), max);
	return { value, min, max };
}

export function applySliderKey(
	state: SliderState,
	keyName: string,
	modifiers?: SliderModifiers,
): SliderState {
	const step = modifiers?.shift ? 10 : 1;
	switch (keyName) {
		case "left":
			return clamp(state, state.value - step);
		case "right":
			return clamp(state, state.value + step);
		case "home":
			return { ...state, value: state.min };
		case "end":
			return { ...state, value: state.max };
		default:
			return state;
	}
}

function clamp(state: SliderState, value: number): SliderState {
	return { ...state, value: Math.min(Math.max(value, state.min), state.max) };
}

export function renderTrack(
	value: number,
	min: number,
	max: number,
	width: number,
): string {
	if (width <= 0) return "";
	const span = max - min;
	if (span <= 0) return "█".repeat(width);
	const filled = Math.round(((value - min) / span) * width);
	return "█".repeat(filled) + "░".repeat(width - filled);
}

export function renderReadout(value: number, min: number, max: number): string {
	return `${value}/${max === min ? value : max}${min !== 0 ? ` (${min})` : ""}`;
}
