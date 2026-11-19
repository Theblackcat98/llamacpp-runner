// biome-ignore-all lint/a11y/noStaticElementInteractions: OpenTUI renderables are terminal cells, not DOM elements; every mouse action here mirrors an existing keyboard binding (Tier 3)
import type { MouseEvent } from "@opentui/core";
import { useScopedKeyboard } from "../hooks/use-scoped-keyboard";
import type { Theme } from "../themes";

export interface CheckboxProps {
	theme: Theme;
	captureKeys: boolean;
	checked: boolean;
	focused?: boolean;
	label?: string;
	/** Availability-disabled fields ignore mouse clicks too (Tier 3). */
	disabled?: boolean;
	onToggle?: () => void;
}

export function Checkbox({
	theme,
	captureKeys,
	checked,
	focused = false,
	label,
	disabled = false,
	onToggle,
}: CheckboxProps) {
	useScopedKeyboard(captureKeys, (key) => {
		if (key.name === "space") onToggle?.();
	});

	// Tier 3 mouse (additive): clicking the box toggles it, same as Space.
	const handleMouseDown = (event: MouseEvent) => {
		if (event.button !== 0 || disabled) return;
		event.stopPropagation();
		onToggle?.();
	};

	return (
		<box onMouseDown={handleMouseDown}>
			<text fg={focused ? theme.fgBright : theme.fg}>
				{focused ? <span fg={theme.accent}>{"> "}</span> : null}
				<span fg={focused ? theme.accent : theme.border}>[</span>
				<span fg={checked ? theme.success : theme.muted}>
					{checked ? "x" : " "}
				</span>
				<span fg={focused ? theme.accent : theme.border}>]</span>
				{label ? <span>{` ${label}`}</span> : null}
			</text>
		</box>
	);
}
