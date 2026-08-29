import { useEffect, useReducer } from "react";
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
	/** Visible label rendered before the buffer (Phase 13). */
	label?: string;
	placeholder?: string;
	/** External source of truth; when it diverges from the buffer the input
	 * resets to it (preset load / model change sync, Phase 13). */
	value?: string;
	onChange?: (state: TextInputState) => void;
	width?: number;
}

export function keyEventToInputKey(key: {
	name?: string;
	ctrl?: boolean;
	meta?: boolean;
	shift?: boolean;
}): TextInputKey | null {
	if (key.ctrl || key.meta) return null;
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
	const name = key.name ?? "";
	if (name.length === 1) return { kind: "printable", ch: name };
	return null;
}

export function TextInput({
	theme,
	captureKeys,
	label,
	placeholder,
	onChange,
	initial,
	value,
	maxLength,
	numeric,
	width = 24,
}: TextInputProps) {
	const [state, dispatch] = useReducer(
		(s: TextInputState, k: TextInputKey) =>
			applyKey(s, k, { maxLength, numeric }),
		undefined,
		() => createTextInputState({ initial, maxLength, numeric }),
	);

	// Phase 13: controlled-from-outside sync — follow the external value only
	// when it differs from what the user currently sees, so mid-edit caret
	// position is preserved while preset loads / model changes snap the buffer.
	useEffect(() => {
		if (value === undefined || value === state.buffer) return;
		dispatch({ kind: "reset", value });
	}, [value, state.buffer]);

	useEffect(() => {
		onChange?.(state);
	}, [state, onChange]);

	useScopedKeyboard(captureKeys, (key) => {
		const mapped = keyEventToInputKey(key);
		if (mapped) dispatch(mapped);
	});

	const shown = state.buffer.length === 0 ? (placeholder ?? "") : state.buffer;
	const cursorAtPlaceholder = state.buffer.length === 0;
	const cursor = cursorAtPlaceholder ? 0 : state.cursor;
	const before = shown.slice(0, cursor);
	const at = shown[cursor] ?? " ";
	const after = shown.slice(cursor + 1);

	return (
		<text fg={cursorAtPlaceholder ? theme.muted : theme.fg} width={width}>
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
