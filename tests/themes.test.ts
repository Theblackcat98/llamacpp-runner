import { describe, expect, it } from "bun:test";
import {
	CATPPUCCIN,
	CYBERPUNK,
	GRUVBOX,
	MATRIX,
	THEME_NAMES,
	THEMES,
	TOKYO_NIGHT,
	themeByName,
} from "../src/ui/themes";

describe("theme tokens lifted from plans/opentui.html (P2-FR-14)", () => {
	it("tokyo night matches the mockup :root block", () => {
		expect(TOKYO_NIGHT).toEqual({
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
		});
	});

	it("catppuccin matches [data-theme=catppuccin]", () => {
		expect(CATPPUCCIN).toEqual({
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
		});
	});

	it("gruvbox matches [data-theme=gruvbox]", () => {
		expect(GRUVBOX).toEqual({
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
		});
	});

	it("cyberpunk matches [data-theme=cyberpunk]", () => {
		expect(CYBERPUNK).toEqual({
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
		});
	});

	it("matrix matches [data-theme=matrix]", () => {
		expect(MATRIX).toEqual({
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
		});
	});

	it("registry carries all 5 themes with unique names (P2-FR-14)", () => {
		expect(THEMES).toHaveLength(5);
		const names = THEMES.map((t) => t.name);
		expect(new Set(names).size).toBe(5);
		expect(THEME_NAMES).toEqual([
			"TokyoNight",
			"Catppuccin",
			"Gruvbox",
			"Cyberpunk",
			"Matrix",
		]);
	});

	it("themeByName falls back to tokyo night for unknown names", () => {
		expect(themeByName("nope")).toBe(TOKYO_NIGHT);
		expect(themeByName("Gruvbox")).toBe(GRUVBOX);
	});
});
