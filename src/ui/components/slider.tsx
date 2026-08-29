import { useScopedKeyboard } from "../hooks/use-scoped-keyboard";
import type { Theme } from "../themes";
import {
	applySliderKey,
	renderReadout,
	renderTrack,
	type SliderModifiers,
	type SliderOptions,
} from "./slider-state";

export interface SliderProps extends SliderOptions {
	theme: Theme;
	captureKeys: boolean;
	focused?: boolean;
	width?: number;
	label?: string;
	onChange?: (value: number) => void;
}

export function Slider({
	theme,
	captureKeys,
	focused = false,
	width = 16,
	label,
	min,
	max,
	value,
	onChange,
}: SliderProps) {
	const current = Math.min(Math.max(value ?? min, min), max);

	useScopedKeyboard(captureKeys, (key) => {
		const name = key.name ?? "";
		if (
			name !== "left" &&
			name !== "right" &&
			name !== "home" &&
			name !== "end"
		)
			return;
		const mods: SliderModifiers = { shift: key.shift === true };
		const next = applySliderKey({ value: current, min, max }, name, mods);
		if (next.value !== current) onChange?.(next.value);
	});

	return (
		<text fg={focused ? theme.fgBright : theme.fg}>
			{label ? <span fg={theme.muted}>{`${label} `}</span> : null}
			<span fg={focused ? theme.accent : theme.border}>[</span>
			<span fg={theme.success}>{renderTrack(current, min, max, width)}</span>
			<span fg={focused ? theme.accent : theme.border}>]</span>
			<span fg={theme.muted}>{` ${renderReadout(current, min, max)}`}</span>
		</text>
	);
}
