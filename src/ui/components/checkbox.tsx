import { useScopedKeyboard } from "../hooks/use-scoped-keyboard";
import type { Theme } from "../themes";

export interface CheckboxProps {
	theme: Theme;
	captureKeys: boolean;
	checked: boolean;
	focused?: boolean;
	label?: string;
	onToggle?: () => void;
}

export function Checkbox({
	theme,
	captureKeys,
	checked,
	focused = false,
	label,
	onToggle,
}: CheckboxProps) {
	useScopedKeyboard(captureKeys, (key) => {
		if (key.name === "space") onToggle?.();
	});

	return (
		<text fg={focused ? theme.fgBright : theme.fg}>
			{focused ? <span fg={theme.accent}>{"> "}</span> : null}
			<span fg={focused ? theme.accent : theme.border}>[</span>
			<span fg={checked ? theme.success : theme.muted}>
				{checked ? "x" : " "}
			</span>
			<span fg={focused ? theme.accent : theme.border}>]</span>
			{label ? <span>{` ${label}`}</span> : null}
		</text>
	);
}
