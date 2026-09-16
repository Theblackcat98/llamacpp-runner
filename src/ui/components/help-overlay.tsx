import { useTerminalDimensions } from "@opentui/react";
import type { Theme } from "../themes";

export interface HelpOverlayProps {
	theme: Theme;
	open: boolean;
	tabName: string;
}

type Row = [key: string, action: string];

/** Always-available shell bindings (mirrors the App keyboard handler). */
const GLOBAL_ROWS: Row[] = [
	["[Tab]", "cycle focus (screen / console drawer)"],
	["[1-4]", "switch tabs"],
	["[Enter]", "launch (set-default on the Presets tab)"],
	["[x]", "kill server (confirms while running)"],
	["[k]", "kill orphaned server (press twice)"],
	["[o]", "collapse / expand console"],
	["[Ctrl+L]", "clear log"],
	["[Ctrl+P]", "command palette"],
	["[q]", "quit (confirms while running)"],
	["[?]", "toggle this legend"],
];

/** Tab-conditional bindings, keyed by the shell tab label. */
const TAB_ROWS: Record<string, Row[]> = {
	"Model Explorer": [
		["[m]", "set models directory"],
		["[r]", "rescan models directory"],
		["[↑↓]", "select model"],
	],
	"Launch Config": [
		["[↑↓]", "move between fields"],
		["[Ctrl+S]", "save preset"],
		["[Esc]", "reset configurator"],
		["[a]", "auto-fit GPU layers to VRAM"],
		["[y]", "yank launch command"],
		["[Ctrl+Y]", "confirm host-exposing launch"],
		["[i]", "import shell command"],
	],
	"Server Telemetry": [["[t]", "toggle telemetry on / off"]],
	Presets: [
		["[c]", "clone preset"],
		["[d]", "delete preset (press twice)"],
		["[Enter]", "set default preset"],
		["[l]", "load into Configurator and go there"],
		["[r]", "relink broken preset to Explorer pick"],
		["[i]", "import shell command"],
	],
};

/**
 * Center a content box in the terminal, clamping it to the terminal
 * dimensions. Origins never go negative, so on tiny terminals the panel
 * pins to the top-left and stays fully visible instead of overflowing (#53).
 */
export function overlayGeometry(
	termWidth: number,
	termHeight: number,
	contentWidth: number,
	contentHeight: number,
): { left: number; top: number; width: number; height: number } {
	const width = Math.max(1, Math.min(contentWidth, termWidth));
	const height = Math.max(1, Math.min(contentHeight, termHeight));
	return {
		left: Math.max(0, Math.floor((termWidth - width) / 2)),
		top: Math.max(0, Math.floor((termHeight - height) / 2)),
		width,
		height,
	};
}

/**
 * Darken a #rrggbb color by `factor` (0..1) for the modal backdrop.
 * Terminals have no alpha, so "dimming" the background behind the panel
 * means painting the backdrop darker than the app surface (#53).
 */
export function dimHex(hex: string, factor: number): string {
	const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
	if (!m?.[1]) return hex;
	const scale = (v: number) =>
		Math.max(0, Math.min(255, Math.round(v * factor)));
	const r = scale(parseInt(m[1].slice(0, 2), 16));
	const g = scale(parseInt(m[1].slice(2, 4), 16));
	const b = scale(parseInt(m[1].slice(4, 6), 16));
	return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}
/**
 * Help overlay (F15): `?` legend over the tab-conditional bindings the
 * footer cannot fit. Static render like the palette; open state and `?`
 * toggling are owned by the shell. `?` (not Esc) closes it so typing Esc
 * in the Configurator (reset) never double-fires. Centered and clamped to
 * the terminal with a dimmed backdrop so it reads as modal (#53).
 */
export function HelpOverlay({ theme, open, tabName }: HelpOverlayProps) {
	const { width: termWidth, height: termHeight } = useTerminalDimensions();
	if (!open) return null;
	const tabRows = TAB_ROWS[tabName] ?? [];
	const geometry = overlayGeometry(
		termWidth,
		termHeight,
		76,
		GLOBAL_ROWS.length + tabRows.length + 7,
	);
	return (
		<box
			style={{
				position: "absolute",
				left: 0,
				top: 0,
				width: "100%",
				height: "100%",
				backgroundColor: dimHex(theme.bg, 0.55),
				flexDirection: "column",
			}}
		>
			<box
				title={`Keyboard shortcuts — ${tabName}`}
				style={{
					position: "absolute",
					left: geometry.left,
					top: geometry.top,
					width: geometry.width,
					height: geometry.height,
					border: true,
					borderColor: theme.accent,
					backgroundColor: theme.bg,
					flexDirection: "column",
					paddingLeft: 1,
				}}
			>
				<text fg={theme.accent}>{" Global"}</text>
				{GLOBAL_ROWS.map(([key, action]) => (
					<text key={key} fg={theme.fg}>
						{`  ${key}  ${action}`}
					</text>
				))}
				<text fg={theme.accent}>{` ${tabName}`}</text>
				{tabRows.map(([key, action]) => (
					<text key={key} fg={theme.fg}>
						{`  ${key}  ${action}`}
					</text>
				))}
				<text fg={theme.muted}>{" press [?] to close"}</text>
			</box>
		</box>
	);
}
