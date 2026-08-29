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
import { Palette } from "./components/palette";
import { ConsoleDrawer } from "./console-drawer";
import {
	buildDefaultActions,
	type PaletteHandlers,
} from "./logic/action-registry";
import type { ConfiguratorState } from "./logic/configurator-state";
import {
	createDrawerState,
	type DrawerState,
	pinToTail,
	scrollBy,
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
import {
	createQuitState,
	handleHostKey,
	handleKillKey,
	handleQuitKey,
	type QuitState,
} from "./logic/quit-state";
import {
	cycleFocus,
	isQuitKey,
	type KeyRef,
	TAB_COUNT,
} from "./logic/shell-state";
import { buildTelemetryViewModel } from "./logic/telemetry-state";
import { Configurator } from "./screens/configurator";
import { Explorer } from "./screens/explorer";
import { PresetsScreen } from "./screens/presets";
import { Telemetry } from "./screens/telemetry";
import type { Theme } from "./themes";

const TAB_LABELS = [
	"Model Explorer",
	"Launch Config",
	"Server Telemetry",
	"Presets",
];
const PANE_COUNT = 4;
const DRAWER_HEIGHT = 6;

export interface ExplorerControl {
	entries: import("../core/models/types").ModelEntry[];
	scanning: boolean;
	modelsDir: string | null;
	scanError?: string;
	selectedIndex?: number;
	onSelectIndex?: (index: number) => void;
	onRescan: () => void;
	onUseDefaultDir: (dir: string) => void;
}

export interface ConfiguratorControl {
	state: ConfiguratorState;
	setState: (next: ConfiguratorState) => void;
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
export interface PaletteControl extends Partial<PaletteHandlers> {}

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
	onSavePreset?: () => void;
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
}

export function App({
	theme,
	onQuit,
	onLaunch,
	onKill,
	onKillOrphan,
	onSavePreset,
	onYankCommand,
	onConfirmHost,
	drawerControl,
	explorerControl,
	configuratorControl,
	presetsControl,
	telemetryControl,
	paletteControl,
	serverRunning = false,
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
	const [tab, setTab] = useState(0);
	const [focusPane, setFocusPane] = useState(0);
	const [internalDrawer, setInternalDrawer] = useState(() =>
		createDrawerState(DRAWER_HEIGHT),
	);
	const drawer = drawerControl?.state ?? internalDrawer;
	const setDrawer = drawerControl?.setState ?? setInternalDrawer;
	const [collapsed, setCollapsed] = useState(false);
	const [palette, setPalette] = useState<CmdPaletteState>(createPaletteState);
	const [confirm, setConfirm] = useState<QuitState>(createQuitState);
	const [confirmNotice, setConfirmNotice] = useState<string | null>(null);
	// Phase 13: the Configurator reports its focused field so the shell can
	// yield global printable keys (digits, o/k/q/…) while a text field owns
	// typing — one owner per key, never two.
	const activeConfiguratorField = useRef(0);

	const paletteActions = buildDefaultActions({
		switchTheme: (name) => paletteControl?.switchTheme?.(name),
		setPort: () => setTab(1),
		killServer: () => (onKillOrphan ? onKillOrphan() : onKill?.()),
		exportCommand: () => onYankCommand?.(),
		rescanModels: () => explorerControl?.onRescan(),
		adoptOrphan: () => paletteControl?.adoptOrphan?.(),
		toggleTelemetry: () =>
			paletteControl?.toggleTelemetry?.() ??
			telemetryControl?.onEnableTelemetry?.(),
		goToTab: (t) => setTab(t - 1),
		clearLog: () => setDrawer(() => createDrawerState(DRAWER_HEIGHT)),
	});

	useKeyboard((key: KeyRef) => {
		if ((key.ctrl && key.name === "p") || palette.open) {
			setPalette((prev) => applyPaletteKey(prev, paletteActions, key));
			return;
		}
		// While a Configurator text field is focused, plain printable keys go
		// to the input alone — digits must not switch tabs, o/x/k/q must not
		// trigger shell actions (Phase 13 one-owner rule). Ctrl combos still
		// pass: Ctrl+C/P/S/Y/L are non-printable shell bindings.
		const textFieldActive =
			tab === 1 && focusPane !== 3 && activeConfiguratorField.current >= 7;
		if (textFieldActive && key.name && key.name.length === 1 && !key.ctrl) {
			return;
		}
		if (isQuitKey(key)) {
			const result = handleQuitKey(confirm, Date.now(), serverRunning);
			setConfirm(result.state);
			if (result.action === "quit") {
				setConfirmNotice(null);
				if (onQuit) {
					onQuit();
					return;
				}
				renderer.destroy();
				return;
			}
			if (result.action === "confirm") setConfirmNotice(result.message ?? null);
			return;
		}
		if (key.name === "return" && onLaunch) {
			onLaunch();
			return;
		}
		if (key.name === "x" && !key.ctrl) {
			const result = handleKillKey(confirm, Date.now(), serverRunning);
			setConfirm(result.state);
			if (result.action === "execute") {
				setConfirmNotice(null);
				if (onKillOrphan) onKillOrphan();
				else if (onKill) onKill();
			} else if (result.action === "confirm") {
				setConfirmNotice(result.message ?? null);
			}
			return;
		}
		if (key.name === "k") {
			if (onKillOrphan) onKillOrphan();
			return;
		}
		if (key.ctrl && key.name === "l") {
			setDrawer(() => createDrawerState(DRAWER_HEIGHT));
			return;
		}
		if (key.name === "o") {
			setCollapsed((c) => !c);
			return;
		}
		if (key.name === "r" && explorerControl && tab === 0) {
			explorerControl.onRescan();
			return;
		}
		if (key.ctrl && key.name === "s" && tab === 1 && onSavePreset) {
			onSavePreset();
			return;
		}
		if (key.name === "y" && !key.ctrl && tab === 1 && onYankCommand) {
			onYankCommand();
			return;
		}
		if (key.ctrl && key.name === "y" && onConfirmHost) {
			// Phase 13: host exposure needs an explicit second confirmation.
			const result = handleHostKey(confirm, Date.now());
			setConfirm(result.state);
			if (result.action === "execute") {
				setConfirmNotice(null);
				onConfirmHost();
			} else if (result.action === "confirm") {
				setConfirmNotice(result.message ?? null);
			}
			return;
		}
		if (key.name === "s" && tab === 0 && explorerControl?.modelsDir === null) {
			const home = process.env.HOME ?? "~";
			explorerControl.onUseDefaultDir(`${home}/models/llm`);
			return;
		}
		if (key.name === "t" && !key.ctrl && tab === 2) {
			telemetryControl?.onEnableTelemetry?.();
			return;
		}
		if (key.name === "tab") {
			setFocusPane((p) => cycleFocus(PANE_COUNT, p, !key.shift));
			return;
		}
		const digit = Number.parseInt(key.name ?? "", 10);
		if (digit >= 1 && digit <= TAB_COUNT) {
			setTab(digit - 1);
			// Phase 13: switching screens remaps focus to the content pane so
			// the newly shown screen is immediately interactive.
			setFocusPane(2);
			return;
		}
		if (focusPane === 3) {
			if (key.name === "up") setDrawer((s) => scrollBy(s, -1));
			else if (key.name === "down") setDrawer((s) => scrollBy(s, 1));
			else if (key.name === "g" || key.name === "end") setDrawer(pinToTail);
		}
	});

	if (isDegraded(dims.width, dims.height)) {
		return (
			<DegradedLayout width={dims.width} height={dims.height} theme={theme} />
		);
	}

	return (
		<box
			style={{
				flexDirection: "column",
				width: "100%",
				height: "100%",
				backgroundColor: theme.bg,
			}}
		>
			<box
				title="llama-deck"
				style={{
					border: true,
					borderColor: theme.accent,
					height: 3,
					paddingLeft: 1,
					backgroundColor: theme.surface,
				}}
			>
				<text fg={theme.fgBright}>v0.1.0 — llamacpp Manager</text>
				<text fg={serverRunning ? theme.success : theme.muted}>
					{`  [${procStateLabel(serverRunning)}]`}
				</text>
			</box>
			<box style={{ flexDirection: "row", height: 1 }}>
				{TAB_LABELS.map((label, i) => (
					<text
						key={label}
						fg={i === tab ? theme.bg : theme.muted}
						bg={i === tab ? theme.accent : undefined}
					>{` [${i + 1}] ${label} `}</text>
				))}
			</box>
			<box
				key="screen-pane"
				title={TAB_LABELS[tab]}
				style={{
					flexGrow: 1,
					border: focusPane === 2,
					borderColor: theme.focusBg,
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
					/>
				) : tab === 1 && configuratorControl ? (
					<Configurator
						theme={theme}
						state={configuratorControl.state}
						onChange={configuratorControl.setState}
						focused
						captureKeys={focusPane !== 3}
						onActiveFieldChange={(f) => {
							activeConfiguratorField.current = f;
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
					/>
				) : tab === 3 && presetsControl ? (
					<PresetsScreen
						theme={theme}
						file={presetsControl.file}
						existingModelPaths={presetsControl.existingModelPaths}
						onClone={presetsControl.onClone}
						onDelete={presetsControl.onDelete}
						onSetDefault={presetsControl.onSetDefault}
						onLoad={presetsControl.onLoad}
						onRelink={presetsControl.onRelink}
						focused
						captureKeys={focusPane !== 3}
					/>
				) : (
					<text
						fg={focusPane === 2 ? theme.fg : theme.muted}
					>{`${TAB_LABELS[tab]} arrives in a later phase`}</text>
				)}
			</box>
			<ConsoleDrawer
				lines={visibleEntries(drawer)}
				viewportHeight={DRAWER_HEIGHT}
				focused={focusPane === 3}
				collapsed={collapsed}
				theme={theme}
			/>
			<Palette theme={theme} state={palette} actions={paletteActions} />
			<box
				style={{
					borderStyle: "single",
					height: 3,
					flexDirection: "row",
					backgroundColor: theme.surface,
				}}
			>
				<text fg={confirmNotice ? theme.warn : theme.muted}>
					{" "}
					{confirmNotice ??
						"[Tab] Cycle Focus | [1-4] Tabs | [Enter] Launch | [x] Kill | [o] Console | [Ctrl+L] Clear | [q] Quit"}
				</text>
			</box>
		</box>
	);
}

/** Phase 13: live process state shown in the shell header. */
function procStateLabel(running: boolean): string {
	return running ? "server running" : "idle";
}
