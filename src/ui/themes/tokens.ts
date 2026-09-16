export interface Theme {
	name: string;
	bg: string;
	surface: string;
	fg: string;
	fgBright: string;
	border: string;
	accent: string;
	accentHover: string;
	muted: string;
	success: string;
	warn: string;
	error: string;
	purple: string;
	cyan: string;
	focusBg: string;
}

export type ThemeName = "TokyoNight" | "Catppuccin" | "Gruvbox" | "Cyberpunk";
