import type { Theme, ThemeName } from "./tokens";

export type { Theme, ThemeName };

export const TOKYO_NIGHT: Theme = {
	name: "TokyoNight",
	bg: "#1a1b26",
	surface: "#24283b",
	fg: "#a9b1d6",
	fgBright: "#c0caf5",
	border: "#414868",
	accent: "#7aa2f7",
	accentHover: "#89ddff",
	muted: "#565f89",
	success: "#9ece6a",
	warn: "#e0af68",
	error: "#f7768e",
	purple: "#bb9af7",
	cyan: "#7dcfff",
	focusBg: "#2e3c64",
};

export const CATPPUCCIN: Theme = {
	name: "Catppuccin",
	bg: "#1e1e2e",
	surface: "#313244",
	fg: "#cdd6f4",
	fgBright: "#f5e0dc",
	border: "#45475a",
	accent: "#89b4fa",
	accentHover: "#b4befe",
	muted: "#6c7086",
	success: "#a6e3a1",
	warn: "#f9e2af",
	error: "#f38ba8",
	purple: "#cba6f7",
	cyan: "#89dceb",
	focusBg: "#45475a",
};

export const GRUVBOX: Theme = {
	name: "Gruvbox",
	bg: "#282828",
	surface: "#3c3836",
	fg: "#ebdbb2",
	fgBright: "#fbf1c7",
	border: "#504945",
	accent: "#83a598",
	accentHover: "#8ec07c",
	muted: "#928374",
	success: "#b8bb26",
	warn: "#fabd2f",
	error: "#fb4934",
	purple: "#d3869b",
	cyan: "#8ec07c",
	focusBg: "#504945",
};

export const CYBERPUNK: Theme = {
	name: "Cyberpunk",
	bg: "#0d0e15",
	surface: "#1a1c29",
	fg: "#00f0ff",
	fgBright: "#ffffff",
	border: "#ff0055",
	accent: "#ff0055",
	accentHover: "#ffe600",
	muted: "#4a5171",
	success: "#00ff66",
	warn: "#ffe600",
	error: "#ff0055",
	purple: "#9d00ff",
	cyan: "#00f0ff",
	focusBg: "#33001a",
};

export const MATRIX: Theme = {
	name: "Matrix",
	bg: "#050b05",
	surface: "#0a180a",
	fg: "#00ff41",
	fgBright: "#80ff9f",
	border: "#008f11",
	accent: "#00ff41",
	accentHover: "#66ff8c",
	muted: "#003b00",
	success: "#00ff41",
	warn: "#a3ff00",
	error: "#ff3300",
	purple: "#00ffaa",
	cyan: "#00e5ff",
	focusBg: "#003b00",
};

export const THEMES: Theme[] = [
	TOKYO_NIGHT,
	CATPPUCCIN,
	GRUVBOX,
	CYBERPUNK,
	MATRIX,
];

export const THEME_NAMES: ThemeName[] = THEMES.map((t) => t.name as ThemeName);

export const DEFAULT_THEME: Theme = TOKYO_NIGHT;

export function themeByName(name: string): Theme {
	return THEMES.find((t) => t.name === name) ?? DEFAULT_THEME;
}
