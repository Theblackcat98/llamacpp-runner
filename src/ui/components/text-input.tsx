import { useKeyboard } from "@opentui/react";
import { useEffect, useReducer } from "react";
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
	placeholder?: string;
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
	placeholder,
	onChange,
	initial,
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

	useEffect(() => {
		onChange?.(state);
	}, [state, onChange]);

	useKeyboard((key) => {
		if (!captureKeys) return;
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
			<span>{before}</span>
			<span bg={theme.accent} fg={theme.bg}>
				{at}
			</span>
			<span>{after}</span>
			<span fg={theme.muted}>{state.overwrite ? " OVR" : " INS"}</span>
		</text>
	);
}
