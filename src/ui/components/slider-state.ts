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

/** Coarse step for Shift+arrows: powers of two for wide ranges so Batch
 * Size (1..8192) moves in 256s instead of 10s (audit Tier 2). */
export function coarseStep(min: number, max: number): number {
	const span = max - min;
	if (span >= 2048) return 512;
	if (span >= 512) return 128;
	if (span >= 128) return 32;
	return 10;
}

/** Parse a directly-typed slider value; null when not a finite number. */
export function parseSliderInput(
	text: string,
	min: number,
	max: number,
): number | null {
	const n = Number(text.trim());
	if (text.trim() === "" || !Number.isFinite(n)) return null;
	return Math.min(Math.max(Math.trunc(n), min), max);
}

export function applySliderKey(
	state: SliderState,
	keyName: string,
	modifiers?: SliderModifiers,
): SliderState {
	const step = modifiers?.shift ? coarseStep(state.min, state.max) : 1;
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
