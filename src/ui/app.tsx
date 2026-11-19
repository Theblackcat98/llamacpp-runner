import {
	useKeyboard,
	useRenderer,
	useTerminalDimensions,
} from "@opentui/react";
import {
	type Dispatch,
	type SetStateAction,
	useEffect,
	useRef,
	useState,
} from "react";
import type { PresetFile } from "../core/store/presets";
import { DegradedLayout } from "./components/degraded-layout";
import { FooterHintBar } from "./components/footer-hint-bar";
import { HelpOverlay } from "./components/help-overlay";
import { ImportModal } from "./components/import-modal";
import { Palette } from "./components/palette";
import { SavePresetModal } from "./components/save-preset-modal";
import { ConsoleDrawer } from "./console-drawer";
import { APP_VERSION, CONFIGURATOR_TAB, DRAWER_HEIGHT } from "./constants";
import { detectIconSet, type IconKind, type IconSet, iconFor } from "./glyphs";
import {
	buildDefaultActions,
	type PaletteHandlers,
} from "./logic/action-registry";
import {
	type ConfiguratorState,
	clampContext,
	libraryFromEntries,
	loadPresetInto,
} from "./logic/configurator-state";
import {
	createDrawerState,
	type DrawerState,
	pinToTail,
	scrollBy,
	scrollToTop,
	visibleEntries,
} from "./logic/drawer-state";
import {
	beginResize,
	createRelayout,
	type Dims,
	isDegraded,
	settleDue,
} from "./logic/layout-state";
import {
	applyPaletteKey,
	type PaletteState as CmdPaletteState,
	createPaletteState,
} from "./logic/palette-state";
import { headerStatus } from "./logic/proc-status";
import {
	createQuitState,
	handleKillKey,
	type QuitState,
} from "./logic/quit-state";
import { routeShellKey } from "./logic/shell-key-routing";
import { cycleFocus, type KeyRef, TAB_COUNT } from "./logic/shell-state";
import { buildTelemetryViewModel } from "./logic/telemetry-state";
import { Configurator, isConfiguratorTextField } from "./screens/configurator";
import { Explorer } from "./screens/explorer";
import { PresetsScreen } from "./screens/presets";
import { Telemetry } from "./screens/telemetry";
import type { Theme } from "./themes";

/** Shell tab labels in 1-4 key order. Exported for the docs-consistency test (#22). */
export const TAB_LABELS = [
	"Model Explorer",
	"Launch Config",
	"Server Telemetry",
	"Presets",
];

const TAB_ICON_KINDS: IconKind[] = [
	"tab-explorer",
	"tab-config",
	"tab-telemetry",
	"tab-presets",
];

/** Icon set resolved once at startup from the environment (#51). */
const ICON_SET: IconSet = detectIconSet(process.env);
// Only these two shell regions participate in global focus traversal. Screen
// widgets own their internal fields/rows after the screen receives focus.
const PANE_COUNT = 2;

export interface ExplorerControl {
	entries: import("../core/models/types").ModelEntry[];
	scanning: boolean;
	modelsDir: string | null;
	scanError?: string;
	selectedIndex?: number;
	onSelectIndex?: (index: number) => void;
	onRescan: () => void;
	onSetModelsDir?: (dir: string) => void;
	validateDir?: (dir: string) => string | null;
}

export interface ConfiguratorControl {
	state: ConfiguratorState;
	setState: (next: ConfiguratorState) => void;
	/** Exact command line produced by the SessionApp launch plan. */
	previewCommand?: string;
	hardware?: import("../core/hardware/detect").HardwareInfo | null;
	onAutoFit?: () => void;
	/** Capability map from the binary --help probe. */
	availability?: Record<
		string,
		import("../core/flags/help-parser").FlagAvailability
	>;
}

export interface PresetsControl {
	file: PresetFile;
	existingModelPaths: Set<string>;
	onClone?: (id: string) => void;
	onDelete?: (id: string) => void;
	onSetDefault?: (id: string) => void;
	onLoad?: (preset: import("../core/store/presets").Preset) => void;
	onRelink?: (id: string, newPath: string) => void;
}

export interface TelemetryControl {
	vm: import("./logic/telemetry-state").TelemetryViewModel | null;
	onEnableTelemetry?: () => void;
}

/** Handlers the palette actions dispatch to; missing ones are no-ops. */
export interface PaletteControl extends Partial<PaletteHandlers> {
	/** Current theme id, for the palette's active-theme marker. */
	activeTheme?: string;
}

export interface DrawerControl {
	state: DrawerState;
	setState: Dispatch<SetStateAction<DrawerState>>;
}

export interface AppProps {
	theme: Theme;
	onQuit?: () => void;
	onLaunch?: () => void;
	onKill?: () => void;
	onKillOrphan?: () => void;
	onSavePreset?: (name?: string) => void;
	/** Host-level notice (e.g. 0.0.0.0 confirm) shown in the footer even
	 * when the console drawer is collapsed (audit Tier 2). */
	externalNotice?: string | null;
	onYankCommand?: () => void;
	onConfirmHost?: () => void;
	drawerControl?: DrawerControl;
	explorerControl?: ExplorerControl;
	configuratorControl?: ConfiguratorControl;
	presetsControl?: PresetsControl;
	telemetryControl?: TelemetryControl;
	paletteControl?: PaletteControl;
	/** Live-server signal for quit/kill confirmation (P5-FR-11). */
	serverRunning?: boolean;
	/** #56: the launch FAILED — header renders an error state, never running. */
	serverFailed?: boolean;
	/** #55: pid of the discovered orphaned llama-server, null when none. */
	foundOrphanPid?: number | null;
	/** Tab index restored from lastSession on boot (F9); defaults to 0. */
	initialTab?: number;
}

export function App({
	theme,
	onQuit,
	onLaunch,
	onKill,
	onKillOrphan,
	onSavePreset,
	externalNotice = null,
	onYankCommand,
	onConfirmHost,
	drawerControl,
	explorerControl,
	configuratorControl,
	presetsControl,
	telemetryControl,
	paletteControl,
	serverRunning = false,
	serverFailed = false,
	foundOrphanPid = null,
	initialTab = 0,
}: AppProps) {
	const renderer = useRenderer();
	const { width, height } = useTerminalDimensions();
	const [relayout, setRelayout] = useState(() => createRelayout(width, height));
	const dims: Dims = relayout.committed;

	useEffect(() => {
		setRelayout((s) => beginResize(s, { width, height }, Date.now()));
	}, [width, height]);
	const hasPending = relayout.pending !== null;
	useEffect(() => {
		if (!hasPending) return;
		const id = setInterval(() => {
			setRelayout((s) => {
				const r = settleDue(s, Date.now(), 120);
				return r.state;
			});
		}, 60);
		return () => clearInterval(id);
	}, [hasPending]);
	const [tab, setTab] = useState(() =>
		Math.min(Math.max(initialTab, 0), TAB_COUNT - 1),
	);
	const [focusPane, setFocusPane] = useState(0);
	const [internalDrawer, setInternalDrawer] = useState(() =>
		createDrawerState(DRAWER_HEIGHT),
	);
	const drawer = drawerControl?.state ?? internalDrawer;
	const setDrawer = drawerControl?.setState ?? setInternalDrawer;
	const [collapsed, setCollapsed] = useState(false);
	const [palette, setPalette] = useState<CmdPaletteState>(createPaletteState);
	// F15: `?` legend over the tab-conditional bindings.
	const [helpOpen, setHelpOpen] = useState(false);
	const [importOpen, setImportOpen] = useState(false);
	const [saveNameOpen, setSaveNameOpen] = useState(false);
	const [dirEditSignal, setDirEditSignal] = useState(0);
	const numericEntryRef = useRef(false);
	// Palette Kill reuses the x-key confirm state machine (audit #7):
	// first choose arms + notices, second within 2s executes.
	const paletteConfirmRef = useRef<QuitState>(createQuitState());
	const [confirm, setConfirm] = useState<QuitState>(createQuitState);
	const [confirmNotice, setConfirmNotice] = useState<string | null>(null);
	// F8: killing the orphan is destructive — k arms, k again within 2 s
	// executes (mirrors the preset-delete arm in presets.tsx).
	const [killArmedAt, setKillArmedAt] = useState<number | null>(null);
	// Phase 13: the Configurator reports its focused field so the shell can
	// yield global printable keys (digits, o/k/q/…) while a text field owns
	// typing — one owner per key, never two.
	const activeConfiguratorField = useRef(0);
	// #42: the Explorer notifies at event time; a ref (not state) keeps the
	// yield guard correct within the same key batch that opened the editor.
	const explorerEditingRef = useRef(false);
	// #55: a focused list table claims k for row navigation — the shell must
	// never arm the orphan kill on the same press. Mirrors each screen's
	// render conditions: Explorer hides its table behind first-run, the
	// Telemetry slots table behind dormant.
	const tableFocused =
		focusPane === 0 &&
		((tab === 0 &&
			explorerControl !== undefined &&
			(explorerControl.modelsDir !== null || explorerControl.scanning)) ||
			(tab === 2 && telemetryControl?.vm?.dormant === false) ||
			(tab === 3 && presetsControl !== undefined));

	// Tier 2: an armed confirm's notice must not stick in the footer
	// forever — clear it (and the orphan-kill arm) once the window lapses.
	useEffect(() => {
		if (!confirmNotice) return;
		const id = setTimeout(() => {
			setConfirmNotice(null);
			setConfirm(createQuitState());
			setKillArmedAt(null);
		}, 2600);
		return () => clearTimeout(id);
	}, [confirmNotice]);

	const paletteActions = buildDefaultActions({
		switchTheme: (name) => paletteControl?.switchTheme?.(name),
		setPort: () => {
			setTab(1);
			setFocusPane(0);
		},
		killServer: () => {
			const result = handleKillKey(
				paletteConfirmRef.current,
				Date.now(),
				serverRunning,
			);
			paletteConfirmRef.current = result.state;
			if (result.action === "execute") {
				setConfirmNotice(null);
				if (onKill) onKill();
				else onKillOrphan?.();
			} else if (result.action === "confirm") {
				setConfirmNotice(
					`${result.message ?? "kill running server"} (via palette)`,
				);
			} else {
				setConfirmNotice("no server running — nothing to kill");
			}
		},
		savePreset: () => {
			if (onSavePreset) setSaveNameOpen(true);
		},
		openImport: () => setImportOpen(true),
		setModelsDir: () => {
			setTab(0);
			setFocusPane(0);
			setDirEditSignal((n) => n + 1);
		},
		launchServer: () => onLaunch?.(),
		toggleDrawer: () => setCollapsed((c) => !c),
		openHelp: () => setHelpOpen(true),
		exportCommand: () => onYankCommand?.(),
		rescanModels: () => explorerControl?.onRescan(),
		toggleTelemetry: () =>
			paletteControl?.toggleTelemetry?.() ??
			telemetryControl?.onEnableTelemetry?.(),
		goToTab: (t) => {
			setTab(t - 1);
			setFocusPane(0);
		},
		clearLog: () => setDrawer(() => createDrawerState(DRAWER_HEIGHT)),
		autoFitNgl: () => configuratorControl?.onAutoFit?.(),
	});

	useKeyboard((key: KeyRef) => {
		const actions = routeShellKey(
			{
				tab,
				focusPane,
				textFieldActive:
					(tab === 1 &&
						focusPane === 0 &&
						isConfiguratorTextField(activeConfiguratorField.current)) ||
					(tab === 0 && explorerEditingRef.current),
				dirEditorOpen: tab === 0 && explorerEditingRef.current,
				paletteOpen: palette.open,
				importOpen,
				helpOpen,
				saveNameOpen,
				chipFieldActive: tab === 1 && activeConfiguratorField.current === 1,
				numericEntryActive: numericEntryRef.current,
				drawerCollapsed: collapsed,
				serverRunning,
				confirm,
				killArmedAt,
				nowMs: Date.now(),
				hasLaunch: onLaunch !== undefined,
				hasExplorer: explorerControl !== undefined,
				hasSavePreset: onSavePreset !== undefined,
				hasYank: onYankCommand !== undefined,
				hasConfirmHost: onConfirmHost !== undefined,
				foundOrphanPid: foundOrphanPid ?? null,
				tableFocused,
			},
			key,
		);
		for (const action of actions) {
			switch (action.type) {
				case "yieldToField":
					// The focused field consumes the key via its own listener.
					break;
				case "paletteKey":
					setPalette((prev) =>
						applyPaletteKey(prev, paletteActions, action.key),
					);
					break;
				case "toggleHelp":
					setHelpOpen((open) => !open);
					break;
				case "closeHelp":
					setHelpOpen(false);
					break;
				case "goToConfigurator":
					setTab(CONFIGURATOR_TAB);
					setFocusPane(0);
					break;
				case "setConfirm":
					setConfirm(action.state);
					break;
				case "setNotice":
					setConfirmNotice(action.notice);
					break;
				case "quit":
					if (onQuit) onQuit();
					else renderer.destroy();
					break;
				case "launch":
					if (onLaunch) onLaunch();
					break;
				case "kill":
					if (onKill) onKill();
					break;
				case "armKillOrphan":
					setKillArmedAt(action.nowMs);
					break;
				case "executeKillOrphan":
					setKillArmedAt(null);
					if (onKillOrphan) onKillOrphan();
					break;
				case "clearLog":
					setDrawer(() => createDrawerState(DRAWER_HEIGHT));
					break;
				case "toggleDrawer":
					setCollapsed((c) => !c);
					break;
				case "rescan":
					if (explorerControl) explorerControl.onRescan();
					break;
				case "savePreset":
					// Tier 2: prompt for a name instead of a raw timestamp.
					if (onSavePreset) setSaveNameOpen(true);
					break;
				case "yank":
					if (onYankCommand) onYankCommand();
					break;
				case "openImport":
					setImportOpen(true);
					break;
				case "confirmHost":
					if (onConfirmHost) onConfirmHost();
					break;
				case "enableTelemetry":
					telemetryControl?.onEnableTelemetry?.();
					break;
				case "cycleFocusPane":
					setFocusPane((p) => cycleFocus(PANE_COUNT, p, action.forward));
					break;
				case "switchTab":
					numericEntryRef.current = false;
					setTab(action.tab);
					setFocusPane(0);
					break;
				case "drawerScroll":
					setDrawer((s) => scrollBy(s, action.by));
					break;
				case "drawerPage":
					setDrawer((s) => scrollBy(s, action.by * DRAWER_HEIGHT));
					break;
				case "drawerScrollTop":
					setDrawer(scrollToTop);
					break;
				case "drawerPinTail":
					setDrawer(pinToTail);
					break;
			}
		}
	});

	if (isDegraded(dims.width, dims.height)) {
		return (
			<DegradedLayout width={dims.width} height={dims.height} theme={theme} />
		);
	}

	// F3: re-link target = the Explorer's selected healthy model, offered to
	// broken presets on the Presets tab (P4-FR-18).
	const explorerEntries = explorerControl?.entries ?? [];
	const explorerSelected =
		explorerEntries[
			Math.min(
				explorerControl?.selectedIndex ?? 0,
				Math.max(explorerEntries.length - 1, 0),
			)
		];
	const relinkTarget =
		explorerSelected && !explorerSelected.error
			? { path: explorerSelected.path }
			: undefined;
	// #56: FAILED renders an error-toned status, never "server running".
	const status = headerStatus(serverRunning, serverFailed);

	return (
		<box
			style={{
				flexDirection: "column",
				width: "100%",
				height: "100%",
				backgroundColor: theme.bg,
			}}
		>
			{/* #43: slim 1-line borderless header — the old bordered box cost 3
			    rows for two facts (version + server state). */}
			<box style={{ height: 1, flexDirection: "row", paddingLeft: 1 }}>
				<text>
					<span fg={theme.accent}>{"◆ "}</span>
					<span fg={theme.fgBright}>{"llama-deck "}</span>
					<span fg={theme.muted}>{`v${APP_VERSION}   `}</span>
					<span
						fg={
							status.tone === "error"
								? theme.error
								: status.tone === "success"
									? theme.success
									: theme.muted
						}
					>{`● ${status.label}`}</span>
				</text>
			</box>
			<box style={{ flexDirection: "row", height: 1 }}>
				{TAB_LABELS.map((label, i) => {
					const icon = iconFor(TAB_ICON_KINDS[i] ?? "tab-explorer", ICON_SET);
					const prefix = icon ? `${icon} ` : "";
					return (
						<text
							key={label}
							fg={i === tab ? theme.bg : theme.muted}
							bg={i === tab ? theme.accent : undefined}
						>{` ${prefix}[${i + 1}] ${label} `}</text>
					);
				})}
			</box>
			<box
				key="screen-pane"
				style={{
					flexGrow: 1,
					marginTop: 1,
					paddingLeft: 1,
				}}
			>
				{tab === 0 && explorerControl ? (
					<Explorer
						theme={theme}
						entries={explorerControl.entries}
						scanning={explorerControl.scanning}
						modelsDir={explorerControl.modelsDir}
						scanError={explorerControl.scanError}
						selectedIndex={explorerControl.selectedIndex}
						onSelectIndex={explorerControl.onSelectIndex}
						onSetModelsDir={explorerControl.onSetModelsDir}
						validateDir={explorerControl.validateDir}
						onEditingChange={(editing) => {
							explorerEditingRef.current = editing;
						}}
						onActivate={() => {
							// Tier 3: double-click is the mouse Enter — same
							// navigation the shell's Enter performs on tab 0.
							setTab(CONFIGURATOR_TAB);
							setFocusPane(0);
						}}
						dirEditSignal={dirEditSignal}
						extraRows={collapsed ? 4 : 0}
						focused={focusPane === 0}
						captureKeys={
							focusPane === 0 && !importOpen && !helpOpen && !saveNameOpen
						}
						iconSet={ICON_SET}
					/>
				) : tab === 1 && configuratorControl ? (
					<Configurator
						theme={theme}
						state={configuratorControl.state}
						hardware={configuratorControl.hardware}
						onAutoFit={configuratorControl.onAutoFit}
						onChange={configuratorControl.setState}
						previewCommand={configuratorControl.previewCommand}
						availability={configuratorControl.availability}
						focused={focusPane === 0}
						captureKeys={
							focusPane === 0 && !importOpen && !helpOpen && !saveNameOpen
						}
						onActiveFieldChange={(f) => {
							activeConfiguratorField.current = f;
						}}
						onNumericEntryChange={(editing) => {
							numericEntryRef.current = editing;
						}}
					/>
				) : tab === 2 ? (
					<Telemetry
						theme={theme}
						vm={
							telemetryControl?.vm ?? {
								...buildTelemetryViewModel({
									phase: "IDLE",
									model: null,
									endpoint: null,
									startedAtMs: null,
									nowMs: Date.now(),
									telemetryEnabled: false,
									vramEstimatedBytes: null,
									memUsedBytes: null,
									kvUsageRatio: null,
									promptHistory: [],
									decodeHistory: [],
									slots: [],
									failure: null,
									tailLines: [],
								}),
							}
						}
						onEnableTelemetry={telemetryControl?.onEnableTelemetry}
						focused={focusPane === 0}
						width={dims.width}
						iconSet={ICON_SET}
					/>
				) : tab === 3 && presetsControl ? (
					<PresetsScreen
						theme={theme}
						file={presetsControl.file}
						existingModelPaths={presetsControl.existingModelPaths}
						onClone={presetsControl.onClone}
						onDelete={presetsControl.onDelete}
						onSetDefault={presetsControl.onSetDefault}
						onLoad={(preset) => {
							// F3: loading a preset drops you into the Configurator
							// so Enter launches through the single tested path.
							presetsControl.onLoad?.(preset);
							setTab(CONFIGURATOR_TAB);
							setFocusPane(0);
						}}
						onRelink={presetsControl.onRelink}
						relinkTarget={relinkTarget}
						focused={focusPane === 0}
						captureKeys={
							focusPane === 0 && !importOpen && !helpOpen && !saveNameOpen
						}
					/>
				) : (
					<text
						fg={focusPane === 0 ? theme.fg : theme.muted}
					>{`${TAB_LABELS[tab]} arrives in a later phase`}</text>
				)}
			</box>
			<ConsoleDrawer
				lines={visibleEntries(drawer)}
				viewportHeight={DRAWER_HEIGHT}
				focused={focusPane === 1}
				collapsed={collapsed}
				theme={theme}
			/>
			<Palette
				theme={theme}
				state={palette}
				actions={paletteActions}
				activeTheme={paletteControl?.activeTheme}
			/>
			<SavePresetModal
				theme={theme}
				open={saveNameOpen}
				onClose={() => setSaveNameOpen(false)}
				onSave={(name) => {
					setSaveNameOpen(false);
					onSavePreset?.(name);
				}}
			/>
			<ImportModal
				theme={theme}
				open={importOpen}
				onClose={() => setImportOpen(false)}
				onImport={(parsed) => {
					if (configuratorControl) {
						configuratorControl.setState(
							clampContext(
								loadPresetInto(
									configuratorControl.state,
									parsed.values,
									parsed.modelPath || undefined,
									// #60: real library metadata over fabrication.
									libraryFromEntries(explorerEntries),
								),
							),
						);
					}
					setTab(CONFIGURATOR_TAB);
					setFocusPane(0);
					setImportOpen(false);
				}}
			/>
			{/* #48: borderless one-line dimmed footer legend — the old boxed
			    footer cost 3 rows; hints are contextual per tab and never wrap. */}
			<FooterHintBar
				theme={theme}
				tab={tab}
				width={dims.width}
				notice={externalNotice ?? confirmNotice}
				drawerFocused={focusPane === 1}
			/>
			<HelpOverlay
				theme={theme}
				open={helpOpen}
				tabName={TAB_LABELS[tab] ?? ""}
			/>
		</box>
	);
}
