import { footerHintLine } from "../footer-hints";
import type { Theme } from "../themes";

export interface FooterHintBarProps {
	theme: Theme;
	/** Active shell tab index (0 = Model Explorer … 3 = Presets). */
	tab: number;
	width: number;
	/** Confirm notice overrides the hints (rendered in warn). */
	notice: string | null;
}

/**
 * #48: borderless one-line dimmed footer legend. Not a box — a single
 * <text> row; the hint line itself is pre-fitted to the terminal width so
 * it can never wrap.
 */
export function FooterHintBar({
	theme,
	tab,
	width,
	notice,
}: FooterHintBarProps) {
	return (
		<text fg={notice ? theme.warn : theme.muted}>
			{" "}
			{footerHintLine(tab, width, notice)}
		</text>
	);
}
