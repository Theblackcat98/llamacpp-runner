import { useKeyboard, useRenderer } from "@opentui/react";
import { useState } from "react";
import {
	cycleFocus,
	isQuitKey,
	type KeyRef,
	TAB_COUNT,
} from "./logic/shell-state";
import type { Theme } from "./theme";

const TAB_LABELS = [
	"Model Explorer",
	"Launch Config",
	"Server Telemetry",
	"Presets",
];
const PANE_COUNT = 4;

export interface AppProps {
	theme: Theme;
	onQuit?: () => void;
}

export function App({ theme, onQuit }: AppProps) {
	const renderer = useRenderer();
	const [tab, setTab] = useState(0);
	const [focusPane, setFocusPane] = useState(0);

	useKeyboard((key: KeyRef) => {
		if (isQuitKey(key)) {
			if (onQuit) {
				onQuit();
				return;
			}
			renderer.destroy();
			return;
		}
		if (key.name === "tab") {
			setFocusPane((p) => cycleFocus(PANE_COUNT, p, !key.shift));
			return;
		}
		const digit = Number.parseInt(key.name ?? "", 10);
		if (digit >= 1 && digit <= TAB_COUNT) {
			setTab(digit - 1);
		}
	});

	return (
		<box
			style={{
				flexDirection: "column",
				width: "100%",
				height: "100%",
				backgroundColor: theme.bg,
			}}
		>
			<box
				title="llama-deck"
				style={{
					border: true,
					borderColor: theme.accent,
					height: 3,
					paddingLeft: 1,
					backgroundColor: theme.surface,
				}}
			>
				<text fg={theme.fgBright}>v0.1.0 — llamacpp Manager</text>
			</box>
			<box style={{ flexDirection: "row", height: 1 }}>
				{TAB_LABELS.map((label, i) => (
					<text
						key={label}
						fg={i === tab ? theme.bg : theme.muted}
						bg={i === tab ? theme.accent : undefined}
					>{` [${i + 1}] ${label} `}</text>
				))}
			</box>
			<box
				title={TAB_LABELS[tab]}
				style={{
					flexGrow: 1,
					border: focusPane === 2,
					borderColor: theme.focusBg,
					marginTop: 1,
					paddingLeft: 1,
				}}
			>
				<text
					fg={focusPane === 2 ? theme.fg : theme.muted}
				>{`${TAB_LABELS[tab]} arrives in a later phase`}</text>
			</box>
			<box
				style={{
					borderStyle: "single",
					height: 3,
					flexDirection: "row",
					backgroundColor: theme.surface,
				}}
			>
				<text fg={theme.muted}>
					{
						" [Tab] Cycle Focus | [1-4] Tabs | [Enter] Launch | [x] Kill | [q] Quit "
					}
				</text>
			</box>
		</box>
	);
}
