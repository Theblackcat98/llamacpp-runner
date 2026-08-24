import { MIN_HEIGHT, MIN_WIDTH } from "../logic/layout-state";
import type { Theme } from "../themes";

export interface DegradedLayoutProps {
	width: number;
	height: number;
	theme: Theme;
}

/**
 * Single-column fallback shown below the 100x30 minimum viewport (§7).
 * Never renders overlapping boxes — one bordered pane with the resize hint.
 */
export function DegradedLayout({ width, height, theme }: DegradedLayoutProps) {
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
					paddingLeft: 1,
					paddingRight: 1,
					backgroundColor: theme.surface,
				}}
			>
				<box style={{ flexDirection: "column" }}>
					<text fg={theme.fgBright}>Terminal too small</text>
					<text fg={theme.muted}>
						{`Current viewport is ${width}x${height}.`}
					</text>
					<text fg={theme.accent}>
						{`Resize to at least ${MIN_WIDTH}x${MIN_HEIGHT} to continue.`}
					</text>
				</box>
			</box>
		</box>
	);
}
