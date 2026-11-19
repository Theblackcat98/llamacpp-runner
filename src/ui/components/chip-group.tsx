// biome-ignore-all lint/a11y/noStaticElementInteractions: OpenTUI renderables are terminal cells, not DOM elements; every mouse action here mirrors an existing keyboard binding (Tier 3)
import type { MouseEvent } from "@opentui/core";
import { useEffect, useState } from "react";
import { useScopedKeyboard } from "../hooks/use-scoped-keyboard";
import type { Theme } from "../themes";
import {
	applyChipKey,
	type ChipGroupOptions,
	createChipGroupState,
} from "./chip-group-state";

export interface ChipGroupProps extends ChipGroupOptions {
	theme: Theme;
	captureKeys: boolean;
	focused?: boolean;
	/** Availability-disabled fields ignore mouse clicks too (Tier 3). */
	disabled?: boolean;
	onSelect?: (index: number) => void;
	/** Fires when a typed number matches no chip (arbitrary context size). */
	onSelectValue?: (value: number) => void;
}

export function ChipGroup({
	theme,
	captureKeys,
	focused = false,
	disabled = false,
	chips,
	activeIndex = 0,
	onSelect,
	onSelectValue,
}: ChipGroupProps) {
	const n = chips.length;
	const active = n === 0 ? 0 : Math.min(Math.max(activeIndex, 0), n - 1);
	const [cursor, setCursor] = useState(active);
	const [typed, setTyped] = useState("");

	useEffect(() => {
		setCursor((c) => Math.min(c, Math.max(n - 1, 0)));
	}, [n]);

	useScopedKeyboard(captureKeys && n > 0, (key) => {
		const next = applyChipKey(
			{
				...createChipGroupState({ chips, activeIndex: active }),
				cursor,
				typed,
			},
			key.name ?? "",
		);
		if (next.cursor !== cursor) setCursor(next.cursor);
		setTyped(next.typed);
		if (next.customValue !== null && next.customValue !== undefined) {
			onSelectValue?.(next.customValue);
		} else if (next.activeIndex !== active) {
			onSelect?.(next.activeIndex);
		}
	});

	// Tier 3 mouse (additive): clicking a chip selects it, same as moving
	// the cursor onto it and pressing Space/Enter. Each chip is its own
	// box because mouse events target renderables, not text spans.
	const handleChipMouseDown = (i: number) => (event: MouseEvent) => {
		if (event.button !== 0 || disabled) return;
		event.stopPropagation();
		setCursor(i);
		setTyped("");
		if (i !== active) onSelect?.(i);
	};

	return (
		<box style={{ flexDirection: "row" }}>
			{chips.map((chip, i) => {
				const isCursor = i === cursor && focused;
				// Audit #5: the cursor chip gets visible brackets, not just a
				// colour shift — colour alone is invisible to many users.
				const label = isCursor ? `[${chip}]` : chip;
				return (
					<box key={chip} onMouseDown={handleChipMouseDown(i)}>
						<text
							bg={i === active ? theme.accent : undefined}
							fg={
								i === active
									? theme.bg
									: isCursor
										? theme.fgBright
										: theme.muted
							}
						>{` ${label} `}</text>
					</box>
				);
			})}
			{typed ? <text fg={theme.warn}>{`  ctx=${typed}`}</text> : null}
		</box>
	);
}
