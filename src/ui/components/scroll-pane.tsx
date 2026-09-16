import { useState } from "react";
import { useScopedKeyboard } from "../hooks/use-scoped-keyboard";
import type { Theme } from "../themes";
import {
	applyScrollKey,
	createScrollPaneState,
	growContent,
	type ScrollPaneState,
	visibleWindow,
} from "./scroll-pane-state";

export interface ScrollPaneProps {
	theme: Theme;
	captureKeys: boolean;
	focused?: boolean;
	contentLines: string[];
	viewport: number;
	renderLine?: (line: string, index: number) => string;
}

/** Bounded viewport with sticky-bottom autoscroll (P2-FR-07). */
export function ScrollPane({
	theme,
	captureKeys,
	focused = false,
	contentLines,
	viewport,
}: ScrollPaneProps) {
	const [state, setState] = useState<ScrollPaneState>(() =>
		createScrollPaneState({ contentLines: contentLines.length, viewport }),
	);

	useScopedKeyboard(captureKeys && focused, (key) => {
		const name = key.name ?? "";
		let mapped = "";
		if (
			name === "up" ||
			name === "down" ||
			name === "pageup" ||
			name === "pagedown"
		)
			mapped = name;
		else if (name === "end") mapped = "end";
		else if (name === "home") mapped = "g";
		else if (name === "g") mapped = key.shift ? "G" : "g";
		setState((prev) => applyScrollKey(prev, mapped, contentLines.length));
	});

	const view = visibleWindow(growContent(state, contentLines.length));
	return (
		<text>
			{view.map((i) => {
				const line = contentLines[i] ?? "";
				return (
					<span key={i} fg={focused ? theme.fg : theme.muted}>
						{line}
						{"\n"}
					</span>
				);
			})}
		</text>
	);
}
