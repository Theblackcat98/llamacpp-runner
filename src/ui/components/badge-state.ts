import { iconFor, type IconKind, type IconSet } from "../glyphs";

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

const BADGE_ICON_KIND: Record<BadgeStatus, IconKind> = {
	ok: "badge-ok",
	warn: "badge-warn",
	error: "badge-error",
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

export function badgeGlyph(
	state: BadgeState,
	iconSet: IconSet = "ascii",
): string {
	if (iconSet === "nerd") return iconFor(BADGE_ICON_KIND[state.status], "nerd");
	return GLYPHS[state.status];
}
