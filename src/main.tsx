import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import { createBus } from "./core/bus";
import type { IntentMap, StateMap } from "./core/bus-contract";
import { DEFAULT_HOST, DEFAULT_PORT, LLAMA_SERVER_BIN } from "./core/constants";
import { copyToClipboard } from "./core/export/clipboard";
import { buildCommand } from "./core/flags/builder";
import { getOrDetectHardware, type HardwareInfo } from "./core/hardware/detect";
import { createModelsService } from "./core/models/service";
import type { ModelEntry } from "./core/models/types";
import type { Supervisor } from "./core/process/supervisor";
import { createSession, type LaunchPlan } from "./core/session";
import { loadConfig, saveConfig } from "./core/store/config";
import type { PresetFile } from "./core/store/presets";
import {
	loadPresets,
	presetsFilePath,
	savePresets,
} from "./core/store/presets";
import { type AppPaths, resolvePaths } from "./core/store/state-paths";
import { HealthPoller } from "./core/telemetry/health";
import { MetricsPoller } from "./core/telemetry/metrics";
import { createTelemetryService } from "./core/telemetry/service";
import { SlotsPoller } from "./core/telemetry/slots";
import { App } from "./ui/app";
import { DRAWER_HEIGHT, PRESETS_TAB } from "./ui/constants";
import {
	type ConfiguratorState,
	clampContext,
	createConfigurator,
	effectiveValues,
	loadPresetInto,
	previewLine,
	setFlag,
	solveAutoFitNgl,
	vramRangeBytes,
} from "./ui/logic/configurator-state";
import {
	appendLines,
	createDrawerState,
	type DrawerState,
} from "./ui/logic/drawer-state";
import {
	clonePreset,
	deletePreset,
	relink,
	setDefault,
} from "./ui/logic/presets-state";
import { TAB_COUNT } from "./ui/logic/shell-state";
import { buildTelemetryViewModel } from "./ui/logic/telemetry-state";
import type { ThemeName } from "./ui/themes";
import { DEFAULT_THEME, themeByName } from "./ui/themes";

/** Clamp a persisted tab index into the live tab range (F9). */
function clampTab(tab: unknown): number {
	return typeof tab === "number" && Number.isInteger(tab)
		? Math.min(Math.max(tab, 0), TAB_COUNT - 1)
		: 0;
}

const defaultBus = createBus<IntentMap, StateMap>();
const defaultPaths = resolvePaths();

let planSource: (() => LaunchPlan | null) | null = null;

const defaultSession = createSession({
	paths: defaultPaths,
	bus: defaultBus,
	resolveLaunch: () => planSource?.() ?? null,
});

const defaultModelsService = createModelsService(defaultBus, defaultPaths, {
	// Default scan root is the launch folder; the user can point elsewhere
	// at any time with [m] (persisted to config.json via SET_MODELS_DIR).
	defaultDir: process.cwd(),
});

export interface SessionAppProps {
	bus?: ReturnType<typeof createBus<IntentMap, StateMap>>;
	paths?: AppPaths;
	session?: ReturnType<typeof createSession>;
	modelsService?: ReturnType<typeof createModelsService>;
	onQuit?: () => void;
	setPlanSource?: (fn: () => LaunchPlan | null) => void;
}

/**
 * Stop handle for the telemetry set bound by the SessionApp effect below
 * (Issue #16). Owned exclusively by that effect: assigned on bind, cleared
 * on dispose. Consumed only by the process-quit path, which runs outside
 * React and therefore cannot rely on effect cleanup ordering.
 */
let telemetryStopHandle: (() => void) | null = null;

export function SessionApp({
	bus: propsBus,
	paths: propsPaths,
	session: propsSession,
	onQuit = () => {},
	setPlanSource,
}: SessionAppProps = {}) {
	const bus = propsBus ?? defaultBus;
	const paths = propsPaths ?? defaultPaths;
	const session = propsSession ?? defaultSession;

	const [drawer, setDrawer] = useState<DrawerState>(() =>
		createDrawerState(DRAWER_HEIGHT),
	);
	const [, setTick] = useState(0);
	const [procState, setProcState] =
		useState<import("./core/bus-contract").ProcState>("IDLE");
	const [telemetry, setTelemetry] = useState<
		import("./core/telemetry/service").TelemetrySnapshot
	>({
		phase: "IDLE",
		health: null,
		metrics: null,
		slots: [],
	});
	const [entries, setEntries] = useState<ModelEntry[]>([]);
	const [scanning, setScanning] = useState(false);
	const [scanError, setScanError] = useState<string | undefined>(undefined);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [initialState] = useState(() => {
		const configFile = loadConfig(paths.configDir);
		const presetStore = loadPresets(presetsFilePath(paths.configDir));
		const last = presetStore.data?.lastSession;
		const preset = last
			? presetStore.data?.presets.find((item) => item.id === last.preset_id)
			: undefined;
		return { configFile, presetStore: presetStore.data, last, preset };
	});
	const [modelsDir, setModelsDir] = useState<string | null>(
		() => initialState.configFile.modelsDir ?? null,
	);
	const [hardware, setHardware] = useState<HardwareInfo | null>(
		() => initialState.configFile.hardware ?? null,
	);

	useEffect(() => {
		void getOrDetectHardware(paths.configDir)
			.then(setHardware)
			.catch(() => {});
	}, [paths.configDir]);
	const [config, setConfig] = useState<ConfiguratorState>(() => {
		const base = createConfigurator(null);
		// lastSession restores the last preset into the configurator on boot
		// (P4-FR-19); applied in the initializer so no post-mount effect is
		// needed to converge on the restored state.
		return initialState.preset
			? loadPresetInto(
					base,
					initialState.preset.flags ?? {},
					initialState.preset.model_path,
				)
			: base;
	});
	const configRef = useRef(config);
	configRef.current = config;
	const [themeName, setThemeName] = useState<ThemeName>(() => {
		const saved =
			initialState.configFile.theme ?? initialState.presetStore?.theme;
		return (themeByName(saved ?? "").name as ThemeName) ?? DEFAULT_THEME.name;
	});
	const [presetsFile, setPresetsFile] = useState<PresetFile>(
		() => initialState.presetStore ?? { version: 2, presets: [] },
	);
	const [telemetryEnabled, setTelemetryEnabled] = useState(true);
	const [telemetryEndpoint, setTelemetryEndpoint] = useState("");
	const metricsRef = useRef<MetricsPoller | null>(null);
	const boundSupervisorRef = useRef<Supervisor | null>(null);
	const [procStartedAtMs, setProcStartedAtMs] = useState<number | null>(null);
	const [failure, setFailure] = useState<{
		summary: string;
		suggestion?: string;
	} | null>(null);
	const [tailLines, setTailLines] = useState<string[]>([]);

	useEffect(() => {
		const store = loadPresets(presetsFilePath(paths.configDir));
		if (store.data) {
			bus.emitState("LOG_LINE", {
				stream: "out",
				text: `[SYS] presets loaded: ${store.data.presets.length}`,
			});
		}
		// Boot-sync: trigger rescan on mount so if modelsService.boot() completed
		// before React mounted, we synchronize state immediately (Issue #25).
		bus.emitIntent("RESCAN", {});
	}, [bus, paths.configDir]);

	function persistPresets(next: PresetFile): void {
		setPresetsFile(next);
		const store = loadPresets(presetsFilePath(paths.configDir));
		savePresets(presetsFilePath(paths.configDir), next, {
			migratedFrom: store.migratedFrom === 2 ? undefined : store.migratedFrom,
		});
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: event subscriptions are bound on mount
	useEffect(() => {
		const offLog = bus.onState("LOG_LINE", (event) => {
			setDrawer((s) =>
				appendLines(s, [{ text: event.text, stream: event.stream }]),
			);
		});
		const offProc = bus.onState("PROC_STATE", (event) => {
			setProcState(event.state);
			if (event.state === "IDLE") {
				setProcStartedAtMs(null);
			} else if (event.startedAtMs) {
				setProcStartedAtMs(event.startedAtMs);
			}
			if (event.state === "FAILED") {
				if (event.tail && event.tail.length > 0) {
					setTailLines(event.tail);
				} else if (session.supervisor) {
					setTailLines(session.supervisor.snapshotTail(50));
				}
			} else if (event.state === "STARTING" || event.state === "LOADING") {
				setFailure(null);
				setTailLines([]);
			}
			setTick((t) => t + 1);
		});
		const offFailure = bus.onState("FAILURE_CLASSIFIED", (event) => {
			setFailure({ summary: event.summary, suggestion: event.suggestion });
		});
		const offTelemetry = bus.onState("TELEMETRY_STATE", (event) => {
			setTelemetry(event);
		});
		const offModels = bus.onState("MODELS_STATE", (event) => {
			setEntries(event.entries);
			setScanning(event.scanning);
			setScanError(event.error);
			if (event.dir !== undefined && event.dir !== null) {
				setModelsDir(event.dir);
			}
			if (event.entries.length > 0) {
				const current = configRef.current;
				if (current.model) {
					const idx = event.entries.findIndex(
						(e) => e.path === current.model?.path,
					);
					if (idx !== -1) {
						setSelectedIndex(idx);
						const matched = event.entries[idx];
						if (matched) {
							setConfig((prev) => {
								if (!prev.model || prev.model.path !== matched.path) return prev;
								return {
									...prev,
									model: {
										path: matched.path,
										blockCount: matched.blockCount,
										contextLength: matched.contextLength,
										fileSize: matched.totalBytes,
										headCount: matched.headCount,
										headCountKv: matched.headCountKv,
										embeddingLength: matched.embeddingLength,
										keyLength: matched.keyLength,
									},
								};
							});
						}
					} else {
						const firstValid = event.entries.findIndex((e) => !e.error);
						if (firstValid !== -1) {
							selectModelFromEntries(event.entries, firstValid);
						}
					}
				} else {
					const firstValid = event.entries.findIndex((e) => !e.error);
					if (firstValid !== -1) {
						selectModelFromEntries(event.entries, firstValid);
					}
				}
			}
		});
		const offDir = bus.onState("MODELS_DIR", (event) => {
			setModelsDir(event.dir);
		});
		const offConfirm = bus.onState("CONFIRM_REQUIRED", (event) => {
			bus.emitState("LOG_LINE", {
				stream: "out",
				text: `[SYS] host ${event.host} binds ALL interfaces — press Ctrl+Y to confirm launch`,
			});
		});
		const offConflict = bus.onState("PORT_CONFLICT", (event) => {
			bus.emitState("LOG_LINE", {
				stream: "out",
				text: `[SYS] port ${event.requested} in use — next free port: ${event.suggested ?? "?"}`,
			});
		});
		const offBlocked = bus.onState("LAUNCH_BLOCKED", () => {
			bus.emitState("LOG_LINE", {
				stream: "out",
				text: "[SYS] instance already running — press x to stop it first",
			});
		});
		return () => {
			offLog();
			offProc();
			offFailure();
			offTelemetry();
			offModels();
			offDir();
			offConfirm();
			offConflict();
			offBlocked();
		};
	}, []);

	// Telemetry follows the managed server lifecycle — never React render
	// (Issue #16). Exactly one poller set is bound while a server instance
	// is active; it is disposed on exit/kill/swap or when telemetry is
	// toggled off. PROC_STATE transitions drive the effect: React re-runs
	// the previous cleanup before each re-run, so STARTING→LOADING→READY
	// churn keeps the single binding while the transition to IDLE/FAILED
	// (or a supervisor swap) disposes it promptly.
	useEffect(() => {
		const supervisor = session.supervisor;
		if (
			!telemetryEnabled ||
			procState === "IDLE" ||
			procState === "FAILED" ||
			supervisor === null ||
			boundSupervisorRef.current === supervisor
		) {
			return;
		}
		// The session has no supervisor until the first launch resolves a
		// plan (boot uses resolveLaunch only), and every LAUNCH swaps in a
		// fresh supervisor instance — so bind lazily and rebind on swap.
		// Pollers bind to the launch plan's supervisor endpoint at spawn
		// time rather than tracking live configurator edits.
		const endpoint = `http://${supervisor.host ?? DEFAULT_HOST}:${supervisor.port ?? DEFAULT_PORT}`;
		const metrics = new MetricsPoller({ url: `${endpoint}/metrics` });
		const service = createTelemetryService({
			supervisor,
			health: new HealthPoller({ url: `${endpoint}/health` }),
			metrics,
			slots: new SlotsPoller({ url: `${endpoint}/slots` }),
		});
		service.onSnapshot((snapshot) =>
			bus.emitState("TELEMETRY_STATE", snapshot),
		);
		boundSupervisorRef.current = supervisor;
		metricsRef.current = metrics;
		setTelemetryEndpoint(endpoint);
		service.start();
		const stopHandle = () => service.stop();
		telemetryStopHandle = stopHandle;
		return () => {
			service.stop();
			if (telemetryStopHandle === stopHandle) telemetryStopHandle = null;
			if (boundSupervisorRef.current === supervisor)
				boundSupervisorRef.current = null;
			if (metricsRef.current === metrics) metricsRef.current = null;
		};
	}, [bus, procState, session, telemetryEnabled]);

	function selectedEntry(): ModelEntry | undefined {
		return entries[Math.min(selectedIndex, Math.max(entries.length - 1, 0))];
	}

	function selectModelFromEntries(list: ModelEntry[], index: number): void {
		setSelectedIndex(index);
		const entry = list[index];
		if (!entry || entry.error) return;
		setConfig(
			clampContext(
				createConfigurator({
					path: entry.path,
					blockCount: entry.blockCount,
					contextLength: entry.contextLength,
					fileSize: entry.totalBytes,
					headCount: entry.headCount,
					headCountKv: entry.headCountKv,
					embeddingLength: entry.embeddingLength,
					keyLength: entry.keyLength,
				}),
			),
		);
	}

	function selectModel(index: number): void {
		selectModelFromEntries(entries, index);
	}

	function buildPlan(): LaunchPlan | null {
		const cfg = config;
		if (!cfg.model) return null;
		const built = buildCommand({
			modelPath: cfg.model.path,
			meta: { blockCount: cfg.model.blockCount },
			values: effectiveValues(cfg),
		});
		return {
			// F10: honor the configured binary_path (Phase 8 file-level
			// setting); the boot PATH check and pre-spawn which() follow it.
			command: presetsFile.binary_path || LLAMA_SERVER_BIN,
			args: built.args,
			port:
				typeof cfg.values.port === "number"
					? (cfg.values.port as number)
					: DEFAULT_PORT,
			presetId: "ad-hoc",
			host:
				typeof cfg.values.host === "string"
					? (cfg.values.host as string)
					: DEFAULT_HOST,
		};
	}
	if (setPlanSource) {
		setPlanSource(buildPlan);
	} else {
		planSource = buildPlan;
	}

	function handleLaunch(): void {
		bus.emitIntent("LAUNCH", { presetId: "ad-hoc" });
	}

	/** F4: apply + persist the theme so palette switching is reachable. */
	function switchTheme(name: string): void {
		const next = themeByName(name);
		setThemeName(next.name as ThemeName);
		const config = loadConfig(paths.configDir);
		saveConfig(paths.configDir, { ...config, theme: next.name });
		bus.emitState("LOG_LINE", {
			stream: "out",
			text: `[SYS] theme switched to ${next.name}`,
		});
	}

	function handleConfirmHost(): void {
		bus.emitIntent("LAUNCH", { presetId: "ad-hoc", confirmedHost: true });
	}

	function handleLoadPreset(preset: {
		model_path: string;
		flags: Record<string, unknown>;
	}): void {
		setConfig(
			clampContext(loadPresetInto(config, preset.flags, preset.model_path)),
		);
		bus.emitState("LOG_LINE", {
			stream: "out",
			text: "[SYS] preset loaded into configurator",
		});
	}

	function handleRelinkPreset(id: string, newPath: string): void {
		const preset = presetsFile.presets.find((p) => p.id === id);
		if (!preset) return;
		persistPresets({
			...presetsFile,
			presets: presetsFile.presets.map((p) =>
				p.id === id ? relink(p, newPath) : p,
			),
		});
		bus.emitState("LOG_LINE", {
			stream: "out",
			text: `[SYS] preset ${id} relinked to ${newPath}`,
		});
	}

	function handleSavePreset(): void {
		const entry = selectedEntry();
		if (!entry || !config.model) return;
		const store = loadPresets(presetsFilePath(paths.configDir));
		const file = store.data;
		if (!file) return;
		const id = `preset-${Date.now()}`;
		file.presets.push({
			id,
			name: `${entry.name} (saved ${new Date().toISOString().slice(11, 19)})`,
			model_path: config.model.path,
			flags: config.values,
			env_vars: {},
			created_at: new Date().toISOString(),
			last_used: null,
		});
		file.lastSession = { preset_id: id, tab: 1 };
		savePresets(presetsFilePath(paths.configDir), file, {
			migratedFrom: store.migratedFrom === 2 ? undefined : store.migratedFrom,
		});
		bus.emitState("LOG_LINE", {
			stream: "out",
			text: `[SYS] preset saved: ${id}`,
		});
	}

	function handleYank(): void {
		const result = copyToClipboard({ text: previewLine(config) });
		bus.emitState("LOG_LINE", {
			stream: "out",
			text:
				result.method === "failed"
					? `[SYS] ${result.notice}`
					: `[SYS] command yanked to clipboard (${result.method})`,
		});
	}

	function handleAutoFit(): void {
		if (!config.model) return;
		const res = solveAutoFitNgl(config, hardware?.vramBytes);
		setConfig((s) => setFlag(s, "n_gpu_layers", res.ngl));
		bus.emitState("LOG_LINE", {
			stream: "out",
			text: res.fits
				? `[SYS] auto-fit solved ngl=${res.ngl}`
				: `[SYS] auto-fit warning: ${res.message ?? "cannot fit in VRAM"}`,
		});
	}

	return (
		<App
			theme={themeByName(themeName)}
			initialTab={clampTab(initialState.last?.tab)}
			onQuit={onQuit}
			onLaunch={handleLaunch}
			onKill={() => bus.emitIntent("KILL", {})}
			onKillOrphan={() => {
				void session.killFoundOrphan().then(() => setTick((t) => t + 1));
			}}
			onSavePreset={handleSavePreset}
			onYankCommand={handleYank}
			onConfirmHost={handleConfirmHost}
			drawerControl={{ state: drawer, setState: setDrawer }}
			explorerControl={{
				entries,
				scanning,
				modelsDir,
				scanError,
				selectedIndex,
				onSelectIndex: selectModel,
				onRescan: () => bus.emitIntent("RESCAN", {}),
				onSetModelsDir: (dir: string) =>
					bus.emitIntent("SET_MODELS_DIR", { dir }),
			}}
			telemetryControl={{
				onEnableTelemetry: () => {
					setTelemetryEnabled((enabled) => !enabled);
				},
				vm: buildTelemetryViewModel({
					phase: telemetry.phase,
					model: config.model?.path ?? null,
					endpoint: telemetry.health ? telemetryEndpoint || null : null,
					startedAtMs:
						procState === "IDLE"
							? null
							: (procStartedAtMs ?? session.supervisor?.startedAtMs ?? null),
					nowMs: Date.now(),
					telemetryEnabled,
					vramEstimatedBytes: vramRangeBytes(config),
					memUsedBytes: telemetry.metrics?.memUsedBytes ?? null,
					kvUsageRatio: telemetry.metrics?.kvUsageRatio ?? null,
					promptHistory: metricsRef.current?.promptHistory.snapshot() ?? [],
					decodeHistory: metricsRef.current?.decodeHistory.snapshot() ?? [],
					slots: telemetry.slots,
					failure,
					tailLines,
				}),
			}}
			configuratorControl={{
				state: config,
				setState: (next) => setConfig(next),
				hardware,
				onAutoFit: handleAutoFit,
			}}
			presetsControl={{
				file: presetsFile,
				existingModelPaths: new Set(entries.map((e) => e.path)),
				onClone: (id) => persistPresets(clonePreset(presetsFile, id)),
				onDelete: (id) => persistPresets(deletePreset(presetsFile, id)),
				onSetDefault: (id) =>
					persistPresets(setDefault(presetsFile, id, PRESETS_TAB)),
				onLoad: handleLoadPreset,
				onRelink: handleRelinkPreset,
			}}
			paletteControl={{
				switchTheme,
				toggleTelemetry: () => {
					// The telemetry effect binds/disposes on this flag — no
					// direct service handling here (Issue #16).
					setTelemetryEnabled((enabled) => !enabled);
				},
			}}
			serverRunning={procState !== "IDLE"}
		/>
	);
}

if (import.meta.main) {
	await defaultSession.boot();
	defaultModelsService.boot();
	const renderer = await createCliRenderer();
	createRoot(renderer).render(
		<SessionApp
			onQuit={() => {
				defaultModelsService.dispose();
				telemetryStopHandle?.();
				void defaultSession.shutdown().then(() => renderer.destroy());
			}}
		/>,
	);
}
