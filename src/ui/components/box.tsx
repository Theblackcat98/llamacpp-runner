import type { ReactNode } from "react";
import type { Theme } from "../themes";

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

/** Themed box container — P2-FR-08. All four design-system border variants. */
export function TuiBox({
	theme,
	variant = "single",
	title,
	accent = false,
	focused = false,
	width,
	height,
	flexGrow,
	children,
}: TuiBoxProps) {
	const borderColor = focused
		? theme.accentHover
		: accent
			? theme.accent
			: theme.border;
	return (
		<box
			title={title}
			border={true}
			borderStyle={STYLE_MAP[variant]}
			borderColor={borderColor}
			width={width}
			height={height}
			flexGrow={flexGrow}
		>
			{children}
		</box>
	);
}
