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
