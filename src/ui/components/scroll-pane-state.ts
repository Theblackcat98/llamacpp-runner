export interface ScrollPaneState {
	viewport: number;
	scrollTop: number;
	following: boolean;
}

export function createScrollPaneState(options: {
	contentLines: number;
	viewport: number;
}): ScrollPaneState {
	const scrollTop = Math.max(0, options.contentLines - options.viewport);
	return { viewport: options.viewport, scrollTop, following: true };
}

function maxScroll(contentLines: number, viewport: number): number {
	return Math.max(0, contentLines - viewport);
}

export function applyScrollKey(
	state: ScrollPaneState,
	keyName: string,
	contentLines: number,
): ScrollPaneState {
	const max = maxScroll(contentLines, state.viewport);
	switch (keyName) {
		case "up":
		case "k": {
			if (state.scrollTop <= 0) return state;
			return {
				...state,
				scrollTop: state.scrollTop - 1,
				following: false,
			};
		}
		case "down":
		case "j":
			if (state.following) return state;
			return { ...state, scrollTop: Math.min(state.scrollTop + 1, max) };
		case "pageup": {
			if (state.scrollTop <= 0) return state;
			return {
				...state,
				scrollTop: Math.max(0, state.scrollTop - state.viewport),
				following: false,
			};
		}
		case "pagedown":
			if (state.following) return state;
			return {
				...state,
				scrollTop: Math.min(state.scrollTop + state.viewport, max),
			};
		case "G":
		case "end":
			return { ...state, scrollTop: max, following: true };
		case "g":
		case "home":
			return { ...state, scrollTop: 0, following: false };
		default:
			return state;
	}
}

/** Advance the window when new content arrives; respects follow mode. */
export function growContent(
	state: ScrollPaneState,
	newContentLines: number,
): ScrollPaneState {
	const max = maxScroll(newContentLines, state.viewport);
	if (state.following) return { ...state, scrollTop: max };
	return { ...state, scrollTop: Math.min(state.scrollTop, max) };
}

export function isFollowing(state: ScrollPaneState): boolean {
	return state.following;
}

export function visibleWindow(state: ScrollPaneState): number[] {
	const out: number[] = [];
	for (let i = state.scrollTop; i < state.scrollTop + state.viewport; i++)
		out.push(i);
	return out;
}
