import { useEffect, useState } from "react";
import { useScopedKeyboard } from "../hooks/use-scoped-keyboard";
import type { Theme } from "../themes";
import { applyChipKey, type ChipGroupOptions } from "./chip-group-state";

export interface ChipGroupProps extends ChipGroupOptions {
	theme: Theme;
	captureKeys: boolean;
	focused?: boolean;
	onSelect?: (index: number) => void;
}

export function ChipGroup({
	theme,
	captureKeys,
	focused = false,
	chips,
	activeIndex = 0,
	onSelect,
}: ChipGroupProps) {
	const n = chips.length;
	const active = n === 0 ? 0 : Math.min(Math.max(activeIndex, 0), n - 1);
	const [cursor, setCursor] = useState(active);

	useEffect(() => {
		setCursor((c) => Math.min(c, Math.max(n - 1, 0)));
	}, [n]);

	useScopedKeyboard(captureKeys && n > 0, (key) => {
		const next = applyChipKey(
			{ chips, cursor, activeIndex: active },
			key.name ?? "",
		);
		if (next.cursor !== cursor) setCursor(next.cursor);
		if (next.activeIndex !== active) onSelect?.(next.activeIndex);
	});

	return (
		<text>
			{chips.map((chip, i) => (
				<span
					key={chip}
					bg={i === active ? theme.accent : undefined}
					fg={
						i === active
							? theme.bg
							: i === cursor && focused
								? theme.fgBright
								: theme.muted
					}
				>{` ${chip} `}</span>
			))}
		</text>
	);
}
