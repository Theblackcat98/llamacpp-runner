export interface TextInputState {
	buffer: string;
	cursor: number;
	overwrite: boolean;
}

export interface TextInputOptions {
	initial?: string;
	maxLength?: number;
	numeric?: boolean;
}

export type TextInputKey =
	| { kind: "printable"; ch: string }
	| { kind: "backspace" }
	| { kind: "delete" }
	| { kind: "left" }
	| { kind: "right" }
	| { kind: "home" }
	| { kind: "end" }
	| { kind: "insert-toggle" };

export function createTextInputState(
	options?: TextInputOptions,
): TextInputState {
	const buffer = options?.initial ?? "";
	return {
		buffer,
		cursor: buffer.length,
		overwrite: false,
	};
}

export function applyKey(
	state: TextInputState,
	key: TextInputKey,
	options?: TextInputOptions,
): TextInputState {
	switch (key.kind) {
		case "printable":
			return insert(state, key.ch, options);
		case "backspace":
			if (state.cursor === 0) return state;
			return {
				...state,
				buffer:
					state.buffer.slice(0, state.cursor - 1) +
					state.buffer.slice(state.cursor),
				cursor: state.cursor - 1,
			};
		case "delete":
			if (state.cursor >= state.buffer.length) return state;
			return {
				...state,
				buffer:
					state.buffer.slice(0, state.cursor) +
					state.buffer.slice(state.cursor + 1),
			};
		case "left":
			return { ...state, cursor: Math.max(0, state.cursor - 1) };
		case "right":
			return {
				...state,
				cursor: Math.min(state.buffer.length, state.cursor + 1),
			};
		case "home":
			return { ...state, cursor: 0 };
		case "end":
			return { ...state, cursor: state.buffer.length };
		case "insert-toggle":
			return { ...state, overwrite: !state.overwrite };
	}
}

function insert(
	state: TextInputState,
	ch: string,
	options?: TextInputOptions,
): TextInputState {
	if (options?.numeric && !/^[0-9]$/.test(ch)) return state;
	const max = options?.maxLength;
	const atEnd = state.cursor >= state.buffer.length;
	if (state.overwrite && !atEnd) {
		return {
			...state,
			buffer:
				state.buffer.slice(0, state.cursor) +
				ch +
				state.buffer.slice(state.cursor + 1),
			cursor: state.cursor + 1,
		};
	}
	if (max !== undefined && state.buffer.length >= max) return state;
	return {
		...state,
		buffer:
			state.buffer.slice(0, state.cursor) +
			ch +
			state.buffer.slice(state.cursor),
		cursor: state.cursor + 1,
	};
}
