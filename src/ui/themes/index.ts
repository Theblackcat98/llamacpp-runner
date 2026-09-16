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
	muted: "#7a86b8",
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
	fgBright: "#ffffff",
	border: "#45475a",
	accent: "#89b4fa",
	accentHover: "#b4befe",
	muted: "#8a8fa8",
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
	muted: "#a89984",
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
	fg: "#8fd6e8",
	fgBright: "#ffffff",
	border: "#ff0055",
	accent: "#ff0055",
	accentHover: "#ffe600",
	muted: "#7a86ad",
	success: "#00ff66",
	warn: "#ffe600",
	error: "#ff3131",
	purple: "#9d00ff",
	cyan: "#00f0ff",
	focusBg: "#33001a",
};

export const ROSE_PINE: Theme = {
	name: "RosePine",
	bg: "#191724",
	surface: "#1f1d2e",
	fg: "#e0def4",
	fgBright: "#ffffff",
	border: "#26233a",
	accent: "#c4a7e7",
	accentHover: "#ebbcba",
	muted: "#908caa",
	success: "#31748f",
	warn: "#f6c177",
	error: "#eb6f92",
	purple: "#c4a7e7",
	cyan: "#9ccfd8",
	focusBg: "#26233a",
};

export const NORD: Theme = {
	name: "Nord",
	bg: "#2e3440",
	surface: "#3b4252",
	fg: "#d8dee9",
	fgBright: "#eceff4",
	border: "#434c5e",
	accent: "#88c0d0",
	accentHover: "#8fbcbb",
	muted: "#93a3bd",
	success: "#a3be8c",
	warn: "#ebcb8b",
	error: "#bf616a",
	purple: "#b48ead",
	cyan: "#8fbcbb",
	focusBg: "#434c5e",
};

export const EVERFOREST: Theme = {
	name: "Everforest",
	bg: "#2b3339",
	surface: "#323c41",
	fg: "#d3c6aa",
	fgBright: "#ffffff",
	border: "#3a454a",
	accent: "#83c092",
	accentHover: "#7fbbb3",
	muted: "#9da9a0",
	success: "#a7c080",
	warn: "#dbbc7f",
	error: "#e67e80",
	purple: "#d699b6",
	cyan: "#83c092",
	focusBg: "#3a454a",
};

export const THEMES: Theme[] = [
	TOKYO_NIGHT,
	CATPPUCCIN,
	GRUVBOX,
	CYBERPUNK,
	ROSE_PINE,
	NORD,
	EVERFOREST,
];

export const THEME_NAMES: ThemeName[] = THEMES.map((t) => t.name as ThemeName);

export const DEFAULT_THEME: Theme = TOKYO_NIGHT;

export function themeByName(name: string): Theme {
	const lower = name.toLowerCase();
	return THEMES.find((t) => t.name.toLowerCase() === lower) ?? DEFAULT_THEME;
}
