import type { DrawerEntry } from "./logic/drawer-state";
import { parseSgr } from "./logic/sgr";
import type { Theme } from "./themes";

export interface ConsoleDrawerProps {
	lines: DrawerEntry[];
	viewportHeight: number;
	focused: boolean;
	collapsed: boolean;
	theme: Theme;
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
}: ConsoleDrawerProps) {
	const height = collapsed ? 2 : viewportHeight;
	return (
		<box
			title={collapsed ? "─ Console (o to expand)" : "Console"}
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
					line={entry.text}
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
