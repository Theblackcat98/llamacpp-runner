export const DRAWER_CAPACITY = 10_000;

export interface DrawerEntry {
	id: number;
	text: string;
	/** "out" | "err" — preserves stdout/stderr identity (Phase 13). */
	stream: "out" | "err";
}

export interface DrawerState {
	lines: DrawerEntry[];
	capacity: number;
	viewportHeight: number;
	scrollTop: number | null;
	nextId: number;
}

export function createDrawerState(
	viewportHeight: number,
	capacity = DRAWER_CAPACITY,
): DrawerState {
	return { lines: [], capacity, viewportHeight, scrollTop: null, nextId: 1 };
}

export function appendLines(
	state: DrawerState,
	incoming: Array<string | { text: string; stream: "out" | "err" }>,
): DrawerState {
	if (incoming.length === 0) return state;
	let nextId = state.nextId;
	const appended = incoming.map((entry) => ({
		id: nextId++,
		text: typeof entry === "string" ? entry : entry.text,
		stream: typeof entry === "string" ? ("out" as const) : entry.stream,
	}));
	let lines = state.lines.concat(appended);
	if (lines.length > state.capacity) {
		lines = lines.slice(lines.length - state.capacity);
	}
	return clampScroll({ ...state, lines, nextId });
}

export function setViewportHeight(
	state: DrawerState,
	height: number,
): DrawerState {
	return clampScroll({ ...state, viewportHeight: Math.max(1, height) });
}

export function scrollBy(state: DrawerState, delta: number): DrawerState {
	const base =
		state.scrollTop ?? Math.max(0, state.lines.length - state.viewportHeight);
	return clampScroll({ ...state, scrollTop: base + delta });
}

export function pinToTail(state: DrawerState): DrawerState {
	return { ...state, scrollTop: null };
}

export function isFollowing(state: DrawerState): boolean {
	return state.scrollTop === null;
}

export function visibleEntries(state: DrawerState): DrawerEntry[] {
	const start = isFollowing(state)
		? Math.max(0, state.lines.length - state.viewportHeight)
		: (state.scrollTop ?? 0);
	return state.lines.slice(start, start + state.viewportHeight);
}

export function visibleLines(state: DrawerState): string[] {
	return visibleEntries(state).map((entry) => entry.text);
}

function maxScrollTop(state: DrawerState): number {
	return Math.max(0, state.lines.length - state.viewportHeight);
}

function clampScroll(state: DrawerState): DrawerState {
	if (state.scrollTop === null) return state;
	const max = maxScrollTop(state);
	return { ...state, scrollTop: Math.min(Math.max(state.scrollTop, 0), max) };
}
