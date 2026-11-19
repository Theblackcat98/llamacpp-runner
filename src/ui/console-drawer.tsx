// biome-ignore-all lint/a11y/noStaticElementInteractions: OpenTUI renderables are terminal cells, not DOM elements; every mouse action here mirrors an existing keyboard binding (Tier 3)
import type { MouseEvent } from "@opentui/core";
import type { DrawerEntry } from "./logic/drawer-state";
import { parseSgr } from "./logic/sgr";
import type { Theme } from "./themes";

export interface ConsoleDrawerProps {
	lines: DrawerEntry[];
	viewportHeight: number;
	focused: boolean;
	collapsed: boolean;
	theme: Theme;
	/** Tier 3 mouse: clicking the drawer's title (top border) row
	 * toggles collapse — the mouse equivalent of `o`. */
	onToggleCollapse?: () => void;
	/** Tier 3 mouse: wheel over the drawer scrolls it (by lines). */
	onScrollBy?: (by: number) => void;
}

const LOG_TAG_COLORS: Partial<Record<string, string>> = {
	SRV: "cyan",
	HTTP: "green",
	ERR: "red",
};

export function ConsoleDrawer({
	lines,
	viewportHeight,
	focused,
	collapsed,
	theme,
	onToggleCollapse,
	onScrollBy,
}: ConsoleDrawerProps) {
	// Tier 2: collapsed shows ONE truncated line — slicing `height` wrapped
	// lines into a 2-row box squished them into garbled overlaps.
	const height = collapsed ? 1 : viewportHeight;
	const handleMouseDown = (event: MouseEvent) => {
		if (event.button !== 0) return;
		// Only the title row (the box's top border) toggles — clicks on
		// log lines are inert so text selection/reading never collapses it.
		const top = event.currentTarget?.screenY ?? event.target?.screenY;
		if (top !== undefined && event.y === top) {
			event.stopPropagation();
			onToggleCollapse?.();
		}
	};
	const handleMouseScroll = (event: MouseEvent) => {
		if (collapsed) return;
		const dir = event.scroll?.direction;
		if (dir !== "up" && dir !== "down") return;
		event.stopPropagation();
		onScrollBy?.(dir === "up" ? -3 : 3);
	};
	return (
		<box
			title={collapsed ? "─ Console (o to expand)" : "Console"}
			onMouseDown={handleMouseDown}
			onMouseScroll={handleMouseScroll}
			style={{
				border: true,
				borderColor: focused ? theme.accent : theme.border,
				height: height + 2,
				flexDirection: "column",
				paddingLeft: 1,
			}}
		>
			{lines.slice(-height).map((entry) => (
				<SgrLine
					key={entry.id}
					line={collapsed ? entry.text.slice(0, 160) : entry.text}
					stream={entry.stream}
					theme={theme}
				/>
			))}
		</box>
	);
}

function SgrLine({
	line,
	stream,
	theme,
}: {
	line: string;
	stream: "out" | "err";
	theme: Theme;
}) {
	const segments = parseSgr(line);
	return (
		<text>
			{segments.map((seg) => {
				const fg =
					seg.fg ??
					tagColor(seg.text) ??
					(stream === "err" ? theme.error : theme.fg);
				const key = `${seg.fg ?? ""}|${seg.bold ? "b" : ""}|${seg.text}`;
				if (seg.bold) {
					return (
						<strong key={key} fg={fg}>
							{seg.text}
						</strong>
					);
				}
				return (
					<span key={key} fg={fg}>
						{seg.text}
					</span>
				);
			})}
		</text>
	);
}

function tagColor(text: string): string | undefined {
	const match = /\[(SYS|SRV|HTTP|ERR)\]/.exec(text);
	if (!match?.[1]) return undefined;
	return LOG_TAG_COLORS[match[1]];
}
