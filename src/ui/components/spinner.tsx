import type { Theme } from "../themes";
import { useTick } from "./gauge";
import {
	SPINNER_ASCII,
	SPINNER_BRAILLE,
	SPINNER_QUADRANT,
	spinnerFrame,
} from "./spinner-state";

export type SpinnerStyle = "braille" | "quadrant" | "ascii";

const SETS = {
	braille: SPINNER_BRAILLE,
	quadrant: SPINNER_QUADRANT,
	ascii: SPINNER_ASCII,
};

export interface SpinnerProps {
	theme: Theme;
	style?: SpinnerStyle;
	intervalMs?: number;
	label?: string;
	tickOverride?: number;
}

export function Spinner({
	theme,
	style = "braille",
	intervalMs = 80,
	label,
	tickOverride,
}: SpinnerProps) {
	const tickCount = useTick(intervalMs);
	const frame = spinnerFrame(SETS[style], tickOverride ?? tickCount);
	return (
		<text>
			<span fg={theme.accent}>{frame}</span>
			{label ? <span fg={theme.fg}>{` ${label}`}</span> : null}
		</text>
	);
}
