import type { ReactNode } from "react";
import type { Theme } from "../themes";
import { toTitleCase } from "../title-case";

export type BorderVariant = "single" | "double" | "rounded" | "heavy";

export interface TuiBoxProps {
	theme: Theme;
	variant?: BorderVariant;
	title?: string;
	accent?: boolean;
	focused?: boolean;
	width?: number | `${number}%`;
	height?: number | `${number}%`;
	flexGrow?: number;
	marginTop?: number;
	children?: ReactNode;
}

const STYLE_MAP: Record<
	BorderVariant,
	"single" | "double" | "rounded" | "heavy"
> = {
	single: "single",
	double: "double",
	rounded: "rounded",
	heavy: "heavy",
};

/** Themed box container — P2-FR-08. Rounded is the default border variant;
 * single/double/heavy stay opt-in for panels where they carry meaning. */
export function TuiBox({
	theme,
	variant = "rounded",
	title,
	accent = false,
	focused = false,
	width,
	height,
	flexGrow,
	marginTop,
	children,
}: TuiBoxProps) {
	const borderColor = focused
		? theme.accentHover
		: accent
			? theme.accent
			: theme.border;
	return (
		<box
			title={title === undefined ? undefined : toTitleCase(title)}
			border={true}
			borderStyle={STYLE_MAP[variant]}
			borderColor={borderColor}
			width={width}
			height={height}
			flexGrow={flexGrow}
			style={marginTop === undefined ? undefined : { marginTop }}
		>
			{children}
		</box>
	);
}
