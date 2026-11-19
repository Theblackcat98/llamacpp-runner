// biome-ignore-all lint/a11y/noStaticElementInteractions: OpenTUI renderables are terminal cells, not DOM elements; every mouse action here mirrors an existing keyboard binding (Tier 3)
import type { MouseEvent } from "@opentui/core";
import { useEffect, useState } from "react";
import { useScopedKeyboard } from "../hooks/use-scoped-keyboard";
import type { Theme } from "../themes";
import {
	applySliderKey,
	coarseStep,
	parseSliderInput,
	renderReadout,
	renderTrack,
	type SliderModifiers,
	type SliderOptions,
	valueAtTrackOffset,
} from "./slider-state";

export interface SliderProps extends SliderOptions {
	theme: Theme;
	captureKeys: boolean;
	focused?: boolean;
	width?: number;
	label?: string;
	/** Availability-disabled fields ignore mouse input too (Tier 3). */
	disabled?: boolean;
	onChange?: (value: number) => void;
	/** Reports direct-entry mode so the shell yields digit keys to the field. */
	onEditChange?: (editing: boolean) => void;
}

export function Slider({
	theme,
	captureKeys,
	focused = false,
	width = 16,
	label,
	disabled = false,
	min,
	max,
	value,
	onChange,
	onEditChange,
}: SliderProps) {
	const current = Math.min(Math.max(value ?? min, min), max);
	const [entry, setEntry] = useState<string | null>(null);

	const setEntryBoth = (next: string | null) => {
		setEntry(next);
		onEditChange?.(next !== null);
	};

	// Never strand the shell in numeric-entry mode after unmount.
	useEffect(() => {
		return () => {
			onEditChange?.(false);
		};
	}, [onEditChange]);

	useScopedKeyboard(captureKeys, (key) => {
		const name = key.name ?? "";
		if (entry !== null) {
			if (/^[0-9]$/.test(name)) {
				setEntryBoth((entry + name).slice(0, 10));
				return;
			}
			if (name === "backspace") {
				setEntryBoth(entry.slice(0, -1));
				return;
			}
			if (name === "return" || name === "enter") {
				const parsed = parseSliderInput(entry, min, max);
				setEntryBoth(null);
				if (parsed !== null && parsed !== current) onChange?.(parsed);
				return;
			}
			if (name === "escape") {
				setEntryBoth(null);
				return;
			}
			return;
		}
		// `e` starts direct numeric entry (Tier 2). A bare digit cannot be
		// the trigger: digits 1-4 are the shell's tab-switch keys, and both
		// listeners would fire — one owner per key.
		if ((name === "e" || name === "=") && focused) {
			setEntryBoth("");
			return;
		}
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

	// Tier 3 mouse (additive): clicking ON the track positions the value
	// at the clicked column — the offset comes from the renderable's own
	// screen position, so it stays exact at any layout. Clicks on the
	// label/readout are ignored (they are not the track). The wheel steps
	// by the coarse step so wide ranges stay reachable.
	const trackPrefix = (focused ? 2 : 0) + (label ? label.length + 1 : 0) + 1;
	const handleMouseDown = (event: MouseEvent) => {
		if (event.button !== 0 || disabled || entry !== null) return;
		const origin = event.currentTarget?.screenX ?? event.target?.screenX;
		if (origin === undefined) return;
		const offset = event.x - origin - trackPrefix;
		if (offset < 0 || offset >= width) return;
		event.stopPropagation();
		const next = valueAtTrackOffset(offset, width, min, max);
		if (next !== current) onChange?.(next);
	};
	const handleMouseScroll = (event: MouseEvent) => {
		if (disabled || entry !== null) return;
		const dir = event.scroll?.direction;
		if (dir !== "up" && dir !== "down") return;
		event.stopPropagation();
		const step = coarseStep(min, max);
		const next = Math.min(
			Math.max(current + (dir === "up" ? step : -step), min),
			max,
		);
		if (next !== current) onChange?.(next);
	};

	return (
		<box onMouseDown={handleMouseDown} onMouseScroll={handleMouseScroll}>
			<text fg={focused ? theme.fgBright : theme.fg}>
				{focused ? <span fg={theme.accent}>{"> "}</span> : null}
				{label ? <span fg={theme.muted}>{`${label} `}</span> : null}
				<span fg={focused ? theme.accent : theme.border}>[</span>
				<span fg={theme.success}>{renderTrack(current, min, max, width)}</span>
				<span fg={focused ? theme.accent : theme.border}>]</span>
				{entry !== null ? (
					<span fg={theme.warn}>{` =${entry}_ (Enter ok, Esc cancel)`}</span>
				) : (
					<span fg={theme.muted}>{` ${renderReadout(current, min, max)}`}</span>
				)}
			</text>
		</box>
	);
}
