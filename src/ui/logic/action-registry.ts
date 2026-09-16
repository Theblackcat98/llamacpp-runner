/** Command palette action registry — fixed list per P5-FR-09 (§2.6). */
export interface PaletteHandlers {
	switchTheme: (name: string) => void;
	setPort: () => void;
	killServer: () => void;
	exportCommand: () => void;
	rescanModels: () => void;
	toggleTelemetry: () => void;
	goToTab: (tab: number) => void;
	clearLog: () => void;
	autoFitNgl?: () => void;
}

export interface PaletteAction {
	id: string;
	label: string;
	keywords?: string;
	run: () => void;
}

export const PALETTE_ACTION_IDS = [
	"theme-tokyonight",
	"theme-catppuccin",
	"theme-gruvbox",
	"theme-cyberpunk",
	"theme-matrix",
	"set-port",
	"kill-server",
	"export-command",
	"rescan-models",
	"toggle-telemetry",
	"auto-fit-ngl",
	"go-to-tab-1",
	"go-to-tab-2",
	"go-to-tab-3",
	"go-to-tab-4",
	"clear-log",
] as const;

const THEMES: [string, string][] = [
	["tokyonight", "TokyoNight"],
	["catppuccin", "Catppuccin"],
	["gruvbox", "Gruvbox"],
	["cyberpunk", "Cyberpunk"],
];

const TABS: [number, string][] = [
	[1, "Model Explorer"],
	[2, "Launch Config"],
	[3, "Server Telemetry"],
	[4, "Presets"],
];

export function buildDefaultActions(h: PaletteHandlers): PaletteAction[] {
	const actions: PaletteAction[] = [];
	for (const [id, name] of THEMES) {
		actions.push({
			id: `theme-${id}`,
			label: `Switch Theme: ${name}`,
			keywords: `theme color ${name.toLowerCase()}`,
			run: () => h.switchTheme(id),
		});
	}
	actions.push(
		{
			id: "set-port",
			label: "Set Port (Configurator)",
			keywords: "port network",
			run: () => h.setPort(),
		},
		{
			id: "kill-server",
			label: "Kill Current Server",
			keywords: "kill stop server",
			run: () => h.killServer(),
		},
		{
			id: "export-command",
			label: "Export / Yank Command to Clipboard",
			keywords: "export yank copy clipboard",
			run: () => h.exportCommand(),
		},
		{
			id: "rescan-models",
			label: "Rescan Models Directory",
			keywords: "rescan scan models refresh",
			run: () => h.rescanModels(),
		},
		{
			id: "toggle-telemetry",
			label: "Toggle Telemetry (--slots/--metrics)",
			keywords: "telemetry slots metrics toggle",
			run: () => h.toggleTelemetry(),
		},
		{
			id: "auto-fit-ngl",
			label: "Auto-fit GPU Offload (-ngl) to VRAM",
			keywords: "autofit fit ngl gpu vram layers",
			run: () => h.autoFitNgl?.(),
		},
	);
	for (const [tab, name] of TABS) {
		actions.push({
			id: `go-to-tab-${tab}`,
			label: `Go to Tab [${tab}]: ${name}`,
			keywords: `tab goto navigate ${name.toLowerCase()}`,
			run: () => h.goToTab(tab),
		});
	}
	actions.push({
		id: "clear-log",
		label: "Clear Log Window",
		keywords: "clear log console ctrl+l",
		run: () => h.clearLog(),
	});
	return actions;
}
