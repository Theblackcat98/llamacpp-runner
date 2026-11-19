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
	onSelect?: (index: number) => void;
	/** Fires when a typed number matches no chip (arbitrary context size). */
	onSelectValue?: (value: number) => void;
}

export function ChipGroup({
	theme,
	captureKeys,
	focused = false,
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

	return (
		<text>
			{chips.map((chip, i) => {
				const isCursor = i === cursor && focused;
				// Audit #5: the cursor chip gets visible brackets, not just a
				// colour shift — colour alone is invisible to many users.
				const label = isCursor ? `[${chip}]` : chip;
				return (
					<span
						key={chip}
						bg={i === active ? theme.accent : undefined}
						fg={
							i === active ? theme.bg : isCursor ? theme.fgBright : theme.muted
						}
					>{` ${label} `}</span>
				);
			})}
			{typed ? <span fg={theme.warn}>{`  ctx=${typed}`}</span> : null}
		</text>
	);
}
