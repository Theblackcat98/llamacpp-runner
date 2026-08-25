/**
 * Command palette state (§2.6, P5-FR-09/10): modal fuzzy-search over the
 * fixed action registry. Pure reducer; the shell routes keys here first
 * while open, Esc closes, Ctrl+P toggles.
 */
import type { PaletteAction } from "./action-registry";

export type { PaletteAction };

export interface PaletteState {
	open: boolean;
	query: string;
	selected: number;
}

export function createPaletteState(opts?: { open?: boolean }): PaletteState {
	return { open: opts?.open ?? false, query: "", selected: 0 };
}

export interface PaletteKey {
	name?: string;
	ctrl?: boolean;
	shift?: boolean;
	meta?: boolean;
}

/** Subsequence match with compactness ranking: earlier + tighter wins. */
const WORD_PREFIX_BONUS = 1000;

function rawScore(haystack: string, needle: string): number | null {
	if (needle.length === 0) return 0;
	const hay = haystack.toLowerCase();
	const nd = needle.toLowerCase();
	let hi = 0;
	let score = 0;
	let lastHit = -1;
	for (const ch of nd) {
		const found = hay.indexOf(ch, hi);
		if (found < 0) return null;
		score += found - (lastHit < 0 ? 0 : lastHit) - 1;
		if (lastHit >= 0 && found === lastHit + 1) score -= 1; // adjacency bonus
		score += found === 0 ? 0 : 1;
		lastHit = found;
		hi = found + 1;
	}
	return score;
}

export function fuzzyScore(haystack: string, needle: string): number | null {
	const base = rawScore(haystack, needle);
	if (base === null) return null;
	// A word starting with the query beats any embedded subsequence.
	for (const word of haystack.split(/\s+/)) {
		if (
			needle.length > 0 &&
			word.toLowerCase().startsWith(needle.toLowerCase())
		) {
			return base - WORD_PREFIX_BONUS;
		}
	}
	return base;
}

export function filterActions(
	actions: PaletteAction[],
	query: string,
): PaletteAction[] {
	if (query.length === 0) return actions;
	const scored: [PaletteAction, number][] = [];
	for (const a of actions) {
		const s =
			fuzzyScore(a.label, query) ??
			(a.keywords ? fuzzyScore(a.keywords, query) : null);
		if (s !== null) scored.push([a, s]);
	}
	scored.sort((x, y) => x[1] - y[1] || x[0].id.localeCompare(y[0].id));
	return scored.map(([a]) => a);
}

export function moveSelection(
	state: PaletteState,
	results: PaletteAction[],
	delta: number,
): PaletteState {
	const max = Math.max(results.length - 1, 0);
	return {
		...state,
		selected: Math.min(Math.max(state.selected + delta, 0), max),
	};
}

export function close(state: PaletteState): PaletteState {
	return { ...state, open: false, query: "", selected: 0 };
}

function printable(key: PaletteKey): string | null {
	if (key.ctrl || key.meta || key.shift) return null;
	const name = key.name ?? "";
	return name.length === 1 ? name : null;
}

/**
 * Apply one key event. `actionsForRun` lets tests inject spy actions; when
 * omitted the same list used for filtering is executed.
 */
export function applyPaletteKey(
	state: PaletteState,
	actions: PaletteAction[],
	key: PaletteKey,
	actionsForRun?: PaletteAction[],
): PaletteState {
	if (key.ctrl && key.name === "p")
		return state.open ? close(state) : { ...createPaletteState(), open: true };
	if (!state.open) return state;
	switch (key.name) {
		case "escape":
			return close(state);
		case "up":
			return moveSelection(state, filterActions(actions, state.query), -1);
		case "down":
			return moveSelection(state, filterActions(actions, state.query), 1);
		case "backspace":
			return { ...state, query: state.query.slice(0, -1), selected: 0 };
		case "return": {
			const results = filterActions(actions, state.query);
			const target = results[state.selected] ?? null;
			const runList = actionsForRun ?? results;
			const toRun = runList.find((a) => a.id === target?.id) ?? null;
			toRun?.run();
			return toRun ? close(state) : state;
		}
	}
	const ch = printable(key);
	if (ch) return { ...state, query: state.query + ch, selected: 0 };
	return state;
}
