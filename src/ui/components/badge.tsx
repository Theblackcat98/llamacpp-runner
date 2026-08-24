import type { Theme } from "../themes";
import { type BadgeStatus, badgeGlyph, createBadgeState } from "./badge-state";
import { useTick } from "./gauge";

export interface BadgeProps {
	theme: Theme;
	status: BadgeStatus;
	blink?: boolean;
	label?: string;
	tickOverride?: number;
}

const STATUS_COLORS: Record<BadgeStatus, keyof Theme> = {
	ok: "success",
	warn: "warn",
	error: "error",
};

export function Badge({
	theme,
	status,
	blink = false,
	label,
	tickOverride,
}: BadgeProps) {
	const interval = useTick(500);
	const frame = tickOverride ?? interval;
	const visible = !blink || frame % 2 === 0;

	if (!visible) return <text>{label ? ` ${label}` : "  "}</text>;

	return (
		<text>
			<span fg={theme[STATUS_COLORS[status]]}>
				{badgeGlyph(createBadgeState(status))}
			</span>
			{label ? <span fg={theme.fg}>{` ${label}`}</span> : null}
		</text>
	);
}
