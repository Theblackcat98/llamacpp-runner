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
	reprobeHardware?: () => void;
	savePreset?: () => void;
	openImport?: () => void;
	setModelsDir?: () => void;
	launchServer?: () => void;
	toggleDrawer?: () => void;
	openHelp?: () => void;
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
	"theme-rosepine",
	"theme-nord",
	"theme-everforest",
	"set-port",
	"kill-server",
	"export-command",
	"rescan-models",
	"toggle-telemetry",
	"auto-fit-ngl",
	"reprobe-hardware",
	"go-to-tab-1",
	"go-to-tab-2",
	"go-to-tab-3",
	"go-to-tab-4",
	"clear-log",
	"save-preset",
	"import-command",
	"set-models-dir",
	"launch-server",
	"toggle-drawer",
	"open-help",
] as const;

const THEMES: [string, string][] = [
	["tokyonight", "TokyoNight"],
	["catppuccin", "Catppuccin"],
	["gruvbox", "Gruvbox"],
	["cyberpunk", "Cyberpunk"],
	["rosepine", "Rose Pine"],
	["nord", "Nord"],
	["everforest", "Everforest"],
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
			label: "Go to Launch Config",
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
		{
			id: "reprobe-hardware",
			label: "Re-probe Hardware",
			keywords: "probe hardware gpu vram refresh detect",
			run: () => h.reprobeHardware?.(),
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
	actions.push(
		{
			id: "save-preset",
			label: "Save Preset (prompt for name)",
			keywords: "save preset ctrl+s",
			run: () => h.savePreset?.(),
		},
		{
			id: "import-command",
			label: "Import Shell Command",
			keywords: "import shell command paste",
			run: () => h.openImport?.(),
		},
		{
			id: "set-models-dir",
			label: "Set Models Directory",
			keywords: "models directory folder path",
			run: () => h.setModelsDir?.(),
		},
		{
			id: "launch-server",
			label: "Launch Server",
			keywords: "launch start run server enter",
			run: () => h.launchServer?.(),
		},
		{
			id: "toggle-drawer",
			label: "Toggle Console Drawer",
			keywords: "console drawer log toggle",
			run: () => h.toggleDrawer?.(),
		},
		{
			id: "open-help",
			label: "Help / Keyboard Legend",
			keywords: "help keys shortcuts legend",
			run: () => h.openHelp?.(),
		},
	);
	actions.push({
		id: "clear-log",
		label: "Clear Log Window",
		keywords: "clear log console ctrl+l",
		run: () => h.clearLog(),
	});
	return actions;
}
