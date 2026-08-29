import { useScopedKeyboard } from "../hooks/use-scoped-keyboard";
import type { Theme } from "../themes";
import {
	applySelectKey,
	type CyclingSelectOptions,
} from "./cycling-select-state";

export interface CyclingSelectProps extends CyclingSelectOptions {
	theme: Theme;
	captureKeys: boolean;
	focused?: boolean;
	label?: string;
	onChange?: (index: number) => void;
}

export function CyclingSelect({
	theme,
	captureKeys,
	focused = false,
	label,
	options,
	index = 0,
	onChange,
}: CyclingSelectProps) {
	const n = options.length;
	const current = n === 0 ? 0 : Math.min(Math.max(index, 0), n - 1);

	useScopedKeyboard(captureKeys, (key) => {
		const name = key.name ?? "";
		if (name !== "left" && name !== "right") return;
		const next = applySelectKey({ options, index: current }, name);
		if (next.index !== current) onChange?.(next.index);
	});

	return (
		<text fg={focused ? theme.fgBright : theme.fg}>
			{label ? <span fg={theme.muted}>{`${label} `}</span> : null}
			<span fg={focused ? theme.accent : theme.border}>&lt;</span>
			<span fg={theme.cyan}>{n === 0 ? "—" : options[current]}</span>
			<span fg={focused ? theme.accent : theme.border}>&gt;</span>
		</text>
	);
}
