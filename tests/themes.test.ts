import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	CATPPUCCIN,
	CYBERPUNK,
	EVERFOREST,
	GRUVBOX,
	NORD,
	ROSE_PINE,
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
			muted: "#7a86b8",
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
			muted: "#a89984",
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
		});
	});

	it("rosepine matches Rose Pine palette", () => {
		expect(ROSE_PINE).toEqual({
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
		});
	});

	it("nord matches Nord palette", () => {
		expect(NORD).toEqual({
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
		});
	});

	it("everforest matches Everforest dark palette", () => {
		expect(EVERFOREST).toEqual({
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
		});
	});

	it("themeByName resolves palette action ids case-insensitively (#50)", () => {
		for (const t of THEMES) {
			expect(themeByName(t.name.toLowerCase()).name).toBe(t.name);
		}
		expect(themeByName("Matrix").name).toBe(TOKYO_NIGHT.name);
	});

	it("registry carries all 7 themes with unique names (P2-FR-14, #49, #50)", () => {
		expect(THEMES).toHaveLength(7);
		const names = THEMES.map((t) => t.name);
		expect(new Set(names).size).toBe(7);
		expect(THEME_NAMES).toEqual([
			"TokyoNight",
			"Catppuccin",
			"Gruvbox",
			"Cyberpunk",
			"RosePine",
			"Nord",
			"Everforest",
		]);
	});

	it("themeByName falls back to tokyo night for unknown names", () => {
		expect(themeByName("nope")).toBe(TOKYO_NIGHT);
		expect(themeByName("Gruvbox")).toBe(GRUVBOX);
	});
});

/** WCAG relative luminance for a #rrggbb hex color. */
function luminance(hex: string): number {
	const [r, g, b] = [0, 2, 4].map((i) => {
		const c = Number.parseInt(hex.slice(i + 1, i + 3), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

/** WCAG contrast ratio between two #rrggbb hex colors. */
function contrastRatio(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

function lab(hex: string): [number, number, number] {
	const [r, g, bl] = [0, 2, 4].map((i) => {
		const c = Number.parseInt(hex.slice(i + 1, i + 3), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	const x =
		((r ?? 0) * 0.4124 + (g ?? 0) * 0.3576 + (bl ?? 0) * 0.1805) / 0.95047;
	const y = (r ?? 0) * 0.2126 + (g ?? 0) * 0.7152 + (bl ?? 0) * 0.0722;
	const z =
		((r ?? 0) * 0.0193 + (g ?? 0) * 0.1192 + (bl ?? 0) * 0.9505) / 1.08883;
	const f = (t: number) => (t > 0.008856 ? t ** (1 / 3) : 7.787 * t + 16 / 116);
	const [fx, fy, fz] = [f(x), f(y), f(z)];
	return [
		116 * (fy ?? 0) - 16,
		500 * ((fx ?? 0) - (fy ?? 0)),
		200 * ((fy ?? 0) - (fz ?? 0)),
	];
}

/** CIE76 color difference between two #rrggbb hex colors. */
function deltaE(a: string, b: string): number {
	const [l1, a1, b1] = lab(a);
	const [l2, a2, b2] = lab(b);
	return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

describe("theme contrast (#49)", () => {
	for (const theme of THEMES) {
		it(`${theme.name}: body text fg/fgBright/muted reach 4.5:1 on bg`, () => {
			for (const role of ["fg", "fgBright", "muted"] as const) {
				const ratio = contrastRatio(theme[role], theme.bg);
				expect(ratio).toBeGreaterThanOrEqual(4.5);
			}
		});

		it(`${theme.name}: success/warn/error reach 3:1 on bg`, () => {
			for (const role of ["success", "warn", "error"] as const) {
				const ratio = contrastRatio(theme[role], theme.bg);
				expect(ratio).toBeGreaterThanOrEqual(3);
			}
		});

		it(`${theme.name}: success/warn/error are pairwise distinct`, () => {
			const roles = [theme.success, theme.warn, theme.error];
			for (let i = 0; i < roles.length; i++) {
				for (let j = i + 1; j < roles.length; j++) {
					expect(deltaE(roles[i] ?? "", roles[j] ?? "")).toBeGreaterThanOrEqual(
						20,
					);
				}
			}
		});

		it(`${theme.name}: semantic colors differ from body text`, () => {
			for (const role of ["success", "warn", "error"] as const) {
				expect(deltaE(theme[role], theme.fg)).toBeGreaterThanOrEqual(15);
			}
		});
	}

	it("README theme list matches THEME_NAMES", () => {
		const readme = readFileSync(
			join(import.meta.dir, "..", "README.md"),
			"utf8",
		);
		for (const name of THEME_NAMES) {
			expect(readme).toContain(name);
		}
		expect(readme).not.toContain("Monokai");
	});
});
