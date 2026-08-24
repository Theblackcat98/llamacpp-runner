export type BadgeStatus = "ok" | "warn" | "error";

export interface BadgeState {
	status: BadgeStatus;
	blink: boolean;
	visible: boolean;
}

const GLYPHS: Record<BadgeStatus, string> = {
	ok: "●",
	warn: "▲",
	error: "✖",
};

export function createBadgeState(
	status: BadgeStatus,
	options?: { blink?: boolean },
): BadgeState {
	return { status, blink: options?.blink ?? false, visible: true };
}

export function tick(state: BadgeState): BadgeState {
	if (!state.blink) return state;
	return { ...state, visible: !state.visible };
}

export function badgeGlyph(state: BadgeState): string {
	return GLYPHS[state.status];
}
