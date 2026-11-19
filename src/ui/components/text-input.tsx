import { useEffect, useReducer, useRef } from "react";
import { useScopedKeyboard } from "../hooks/use-scoped-keyboard";
import type { Theme } from "../themes";
import {
	applyKey,
	createTextInputState,
	type TextInputKey,
	type TextInputOptions,
	type TextInputState,
} from "./text-input-state";

export interface TextInputProps extends TextInputOptions {
	theme: Theme;
	captureKeys: boolean;
	focused?: boolean;
	/** Visible label rendered before the buffer (Phase 13). */
	label?: string;
	placeholder?: string;
	/** External source of truth; when it diverges from the buffer the input
	 * resets to it (preset load / model change sync, Phase 13). */
	value?: string;
	onChange?: (state: TextInputState) => void;
	width?: number;
	/** Owning field index within a shared fieldRef scheme (#42): when the
	 * parent moves field focus and a key arrives in the same tick, this
	 * input's subscription is stale — the ref names the current owner. */
	field?: number;
	activeFieldRef?: { current: number };
}

export function keyEventToInputKey(key: {
	name?: string;
	sequence?: string;
	ctrl?: boolean;
	meta?: boolean;
	shift?: boolean;
}): TextInputKey | null {
	if (key.meta) return null;
	if (key.ctrl) {
		// Tier 2 editing ergonomics: readline-style chords.
		switch (key.name) {
			case "a":
				return { kind: "home" };
			case "e":
				return { kind: "end" };
			case "u":
				return { kind: "clear-before" };
			case "w":
				return { kind: "kill-word" };
			case "k":
				return { kind: "kill-line" };
			default:
				return null;
		}
	}
	switch (key.name) {
		case "backspace":
			return { kind: "backspace" };
		case "delete":
			return { kind: "delete" };
		case "left":
			return { kind: "left" };
		case "right":
			return { kind: "right" };
		case "home":
			return { kind: "home" };
		case "end":
			return { kind: "end" };
		case "insert":
			return { kind: "insert-toggle" };
		case "space":
			return { kind: "printable", ch: " " };
	}
	if (
		key.sequence &&
		key.sequence.length === 1 &&
		!/[\p{Cc}]/u.test(key.sequence)
	) {
		return { kind: "printable", ch: key.sequence };
	}
	const name = key.name ?? "";
	if (name.length === 1) {
		const ch = key.shift ? name.toUpperCase() : name;
		return { kind: "printable", ch };
	}
	return null;
}

export function TextInput({
	theme,
	captureKeys,
	focused = false,
	label,
	placeholder,
	onChange,
	initial,
	value,
	maxLength,
	numeric,
	width = 24,
	field,
	activeFieldRef,
}: TextInputProps) {
	const [state, dispatch] = useReducer(
		(s: TextInputState, k: TextInputKey) =>
			applyKey(s, k, { maxLength, numeric }),
		undefined,
		// A controlled `value` wins over `initial` at mount so the buffer
		// starts in sync and the sync effect below stays quiet (#37).
		() =>
			createTextInputState({
				initial: value ?? initial,
				maxLength,
				numeric,
			}),
	);

	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;
	const lastNotifiedBuffer = useRef(state.buffer);

	// Phase 13: controlled-from-outside sync — follow the external value only
	// when it differs from what the user currently sees, so mid-edit caret
	// position is preserved while preset loads / model changes snap the buffer.
	// A buffer not yet reported to the parent is a local edit, not an external
	// divergence; waiting for the notification prevents the old prop from
	// clobbering fast typing before the parent can commit it (#37).
	useEffect(() => {
		if (
			value === undefined ||
			value === state.buffer ||
			state.buffer !== lastNotifiedBuffer.current
		)
			return;
		dispatch({ kind: "reset", value });
	}, [value, state.buffer]);

	// Notify the parent when the buffer genuinely changes — user edits
	// and external resets alike — but never on mount or on
	// callback-identity churn. Firing from an effect (not the key
	// handler) collapses keys processed in one batch into a single
	// notification carrying the final buffer, so fast typing or pasted
	// input can't drop characters (#37).
	useEffect(() => {
		if (state.buffer === lastNotifiedBuffer.current) return;
		lastNotifiedBuffer.current = state.buffer;
		onChangeRef.current?.(state);
	}, [state]);

	useScopedKeyboard(captureKeys, (key) => {
		// A same-tick field move can leave this input's subscription stale
		// (#42): ownership follows the ref, not the last committed render.
		if (
			activeFieldRef &&
			field !== undefined &&
			activeFieldRef.current !== field
		) {
			return;
		}
		const mapped = keyEventToInputKey(key);
		if (mapped) dispatch(mapped);
	});

	const shown = state.buffer.length === 0 ? (placeholder ?? "") : state.buffer;
	const cursorAtPlaceholder = state.buffer.length === 0;
	const cursor = cursorAtPlaceholder ? 0 : state.cursor;
	// Tier 2: horizontal window — long values scroll around the caret
	// instead of wrapping onto extra rows and squashing the form.
	// The block cursor + INS/OVR badge belong to the input that owns the
	// keyboard — in the Configurator that is exactly the focused field
	// (the only one with captureKeys on); standalone inputs with
	// captureKeys are their own owner.
	const ownsKeys = focused || captureKeys;
	const chrome =
		(label ? label.length + 1 : 0) + (ownsKeys ? 2 : 0) + (ownsKeys ? 4 : 0);
	const vis = Math.max(4, width - chrome);
	let start = 0;
	if (shown.length > vis) {
		start = Math.min(Math.max(cursor - vis + 1, 0), shown.length - vis);
	}
	const windowed = shown.slice(start, start + vis);
	const localCursor = cursor - start;
	const before = windowed.slice(0, localCursor);
	const at = windowed[localCursor] ?? " ";
	const after = windowed.slice(localCursor + 1);

	// Tier 2: fields that do not own the keyboard render as plain text —
	// no more four simultaneous block cursors + INS badges.
	if (!ownsKeys) {
		return (
			<text fg={cursorAtPlaceholder ? theme.muted : theme.fg} width={width}>
				{label ? <span fg={theme.muted}>{label} </span> : null}
				<span>{windowed}</span>
			</text>
		);
	}
	return (
		<text fg={cursorAtPlaceholder ? theme.muted : theme.fg} width={width}>
			<span fg={theme.accent}>{"> "}</span>
			{label ? <span fg={theme.muted}>{label} </span> : null}
			<span>{before}</span>
			<span bg={theme.accent} fg={theme.bg}>
				{at}
			</span>
			<span>{after}</span>
			<span fg={theme.muted}>{state.overwrite ? " OVR" : " INS"}</span>
		</text>
	);
}
