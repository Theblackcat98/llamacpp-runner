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
 * Help overlay (F15): `?` legend over the tab-conditional bindings the
 * footer cannot fit. Static render like the palette; open state and `?`
 * toggling are owned by the shell. `?` (not Esc) closes it so typing Esc
 * in the Configurator (reset) never double-fires.
 */
export function HelpOverlay({ theme, open, tabName }: HelpOverlayProps) {
	if (!open) return null;
	const tabRows = TAB_ROWS[tabName] ?? [];
	return (
		<box
			style={{
				position: "absolute",
				left: 0,
				top: 0,
				width: "100%",
				height: "100%",
				backgroundColor: theme.bg,
				flexDirection: "column",
			}}
		>
			<box
				title={`KEYBOARD SHORTCUTS — ${tabName}`}
				style={{
					position: "absolute",
					left: 8,
					top: 2,
					width: 76,
					height: GLOBAL_ROWS.length + tabRows.length + 7,
					border: true,
					borderColor: theme.accent,
					backgroundColor: theme.bg,
					flexDirection: "column",
					paddingLeft: 1,
				}}
			>
				<text fg={theme.accent}>{" GLOBAL"}</text>
				{GLOBAL_ROWS.map(([key, action]) => (
					<text key={key} fg={theme.fg}>
						{`  ${key}  ${action}`}
					</text>
				))}
				<text fg={theme.accent}>{` ${tabName.toUpperCase()}`}</text>
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
