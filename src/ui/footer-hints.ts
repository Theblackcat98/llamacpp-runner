/**
 * Footer hint bar (#48): a borderless one-line dimmed legend. Hints are
 * contextual per shell tab and priority-ordered — the line accumulates
 * parts only while they fit, so it never wraps to a second line.
 */

/**
 * Terminal display width: most chars are 1 column, East Asian wide chars
 * (CJK, fullwidth forms) and common arrows/symbols like ↑↓ are 2.
 */
export function displayWidth(s: string): number {
	let w = 0;
	for (const ch of s) {
		const cp = ch.codePointAt(0) ?? 0;
		w +=
			(cp >= 0x1100 && cp <= 0x115f) ||
			cp === 0x2329 ||
			cp === 0x232a ||
			(cp >= 0x2e80 && cp <= 0x4dbf) ||
			(cp >= 0x4e00 && cp <= 0xa4cf) ||
			(cp >= 0xac00 && cp <= 0xd7a3) ||
			(cp >= 0xf900 && cp <= 0xfaff) ||
			(cp >= 0xfe10 && cp <= 0xfe19) ||
			(cp >= 0xfe30 && cp <= 0xfe4f) ||
			(cp >= 0xff00 && cp <= 0xff60) ||
			(cp >= 0xffe0 && cp <= 0xffe6) ||
			(cp >= 0x20000 && cp <= 0x3fffd)
				? 2
				: 1;
	}
	return w;
}

/** Priority-ordered hint parts per tab: [Model Explorer, Launch Config, Server Telemetry, Presets]. */
const HINTS: string[][] = [
	[
		"[Tab] Focus",
		"[1-4] Tabs",
		"[m] Models dir",
		"[r] Rescan",
		"[↑↓] Select",
		"[Enter] Launch",
		"[x] Kill",
		"[o] Console",
		"[?] Help",
	],
	[
		"[Tab] Focus",
		"[1-4] Tabs",
		"[↑↓] Fields",
		"[Enter] Launch",
		"[Ctrl+S] Save preset",
		"[a] Auto-fit",
		"[y] Yank cmd",
		"[i] Import",
		"[?] Help",
	],
	[
		"[Tab] Focus",
		"[1-4] Tabs",
		"[t] Telemetry",
		"[Enter] Launch",
		"[x] Kill",
		"[?] Help",
	],
	[
		"[Tab] Focus",
		"[1-4] Tabs",
		"[Enter] Set default",
		"[l] Load+go",
		"[c] Clone",
		"[d] Delete",
		"[r] Relink",
		"[?] Help",
	],
];

/**
 * Build the footer hint line for `tab`, guaranteed to fit `width` columns.
 * A confirm `notice` overrides the hints and is hard-clipped to `width`.
 * The trailing `[?] Help` hint is pinned — it is the discovery key for the
 * rest, so middle parts are dropped before it.
 */
export function footerHintLine(
	tab: number,
	width: number,
	notice?: string | null,
): string {
	if (notice)
		return displayWidth(notice) > width
			? [...notice].slice(0, width).join("")
			: notice;
	const PINNED = "[?] Help";
	const parts = HINTS[tab] ?? HINTS[0] ?? [];
	const rest = parts.filter((p) => p !== PINNED);
	const budget = width - displayWidth(PINNED) - 3;
	const kept: string[] = [];
	for (const part of rest) {
		const candidate =
			kept.length === 0 ? part : `${kept.join(" | ")} | ${part}`;
		if (displayWidth(candidate) > budget) break;
		kept.push(part);
	}
	const body = kept.join(" | ");
	if (body.length === 0) {
		return displayWidth(PINNED) > width
			? [...PINNED].slice(0, width).join("")
			: PINNED;
	}
	return `${body} | ${PINNED}`;
}
