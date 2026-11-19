import type { PaletteAction } from "../logic/action-registry";
import { filterActions, type PaletteState } from "../logic/palette-state";
import type { Theme } from "../themes";
import { dimHex } from "./help-overlay";

export interface PaletteProps {
	theme: Theme;
	state: PaletteState;
	actions: PaletteAction[];
	viewport?: number;
	/** Current theme id — the matching theme action gets an (active) marker. */
	activeTheme?: string;
}

/**
 * Command palette overlay (§2.6): modal fuzzy-search over the action
 * registry. Key capture is routed by the shell (P5-FR-10); this renders
 * the modal chrome: query line + ranked results with selection highlight,
 * a result count / scroll indicator, and a dimmed backdrop (Tier 2).
 */
export function Palette({
	theme,
	state,
	actions,
	viewport = 8,
	activeTheme,
}: PaletteProps) {
	if (!state.open) return null;
	const results = filterActions(actions, state.query);
	const start = Math.max(
		0,
		Math.min(
			state.selected - Math.floor(viewport / 2),
			results.length - viewport,
		),
	);
	const visible = results.slice(
		Math.max(start, 0),
		Math.max(start, 0) + viewport,
	);
	const scrollNote =
		results.length > viewport
			? ` · ${Math.max(start, 0) + 1}-${Math.max(start, 0) + visible.length}/${results.length}`
			: "";

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
				title="Command palette"
				style={{
					position: "absolute",
					left: 8,
					top: 3,
					width: 64,
					height: viewport + 4,
					border: true,
					borderColor: theme.accent,
					backgroundColor: theme.bg,
					flexDirection: "column",
					paddingLeft: 1,
				}}
			>
				<text>
					<span fg={theme.accent}>{"> "}</span>
					<span fg={theme.fgBright}>{state.query}</span>
					<span bg={theme.accent} fg={theme.bg}>
						{" "}
					</span>
					<span
						fg={theme.muted}
					>{`  ${results.length} action${results.length === 1 ? "" : "s"}${scrollNote}`}</span>
				</text>
				{visible.length === 0 ? (
					<text fg={theme.muted}> no matching actions</text>
				) : (
					visible.map((a) => {
						const isSelected = results[state.selected]?.id === a.id;
						const isActiveTheme =
							activeTheme !== undefined && a.id === `theme-${activeTheme}`;
						return (
							<text
								key={a.id}
								fg={isSelected ? theme.bg : theme.fg}
								bg={isSelected ? theme.accent : undefined}
							>
								{` ${a.label}${isActiveTheme ? " (active)" : ""}`}
							</text>
						);
					})
				)}
				<text fg={theme.muted}> [↑↓] navigate · [Enter] run · [Esc] close</text>
			</box>
		</box>
	);
}
