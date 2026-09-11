import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { useEffect, useState } from "react";
import { createBus } from "./core/bus";
import type { IntentMap, StateMap } from "./core/bus-contract";
import { DEFAULT_HOST, DEFAULT_PORT, LLAMA_SERVER_BIN } from "./core/constants";
import { copyToClipboard } from "./core/export/clipboard";
import { buildCommand } from "./core/flags/builder";
import { createModelsService } from "./core/models/service";
import type { ModelEntry } from "./core/models/types";
import { createSession, type LaunchPlan } from "./core/session";
import { loadConfig, saveConfig } from "./core/store/config";
import type { PresetFile } from "./core/store/presets";
import {
	loadPresets,
	presetsFilePath,
	savePresets,
} from "./core/store/presets";
import { resolvePaths } from "./core/store/state-paths";
import { HealthPoller } from "./core/telemetry/health";
import { MetricsPoller } from "./core/telemetry/metrics";
import { createTelemetryService } from "./core/telemetry/service";
import { SlotsPoller } from "./core/telemetry/slots";
import { App } from "./ui/app";
import { DRAWER_HEIGHT } from "./ui/constants";
import {
	type ConfiguratorState,
	clampContext,
	createConfigurator,
	effectiveValues,
	loadPresetInto,
	previewLine,
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

const PRESETS_TAB = 3;

/** Clamp a persisted tab index into the live tab range (F9). */
function clampTab(tab: unknown): number {
	return typeof tab === "number" && Number.isInteger(tab)
		? Math.min(Math.max(tab, 0), TAB_COUNT - 1)
		: 0;
}

const bus = createBus<IntentMap, StateMap>();
const paths = resolvePaths();

/**
 * Set by SessionApp on every render; resolves the launch plan from the live
 * configurator values so the spawned argv matches the preview byte-for-byte
 * (P4-FR-03/06, EXIT criterion).
 */
let planSource: (() => LaunchPlan | null) | null = null;

const session = createSession({
	paths,
	bus,
	resolveLaunch: () => planSource?.() ?? null,
});

await session.boot();
const modelsService = createModelsService(bus, paths);
modelsService.boot();

let telemetryService: ReturnType<typeof createTelemetryService> | null = null;
let metricsPoller: MetricsPoller | null = null;
let telemetryEndpoint = "";

const renderer = await createCliRenderer();
createRoot(renderer).render(
	<SessionApp
		onQuit={() => {
			modelsService.dispose();
			telemetryService?.stop();
			void session.shutdown().then(() => renderer.destroy());
		}}
	/>,
);

function SessionApp({ onQuit }: { onQuit: () => void }) {
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
	const [modelsDir, setModelsDir] = useState<string | null>(null);
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
	const [themeName, setThemeName] = useState<ThemeName>(() => {
		const saved =
			initialState.configFile.theme ?? initialState.presetStore?.theme;
		return (themeByName(saved ?? "").name as ThemeName) ?? DEFAULT_THEME.name;
	});
	const [presetsFile, setPresetsFile] = useState<PresetFile>(
		() => initialState.presetStore ?? { version: 2, presets: [] },
	);
	const [telemetryEnabled, setTelemetryEnabled] = useState(true);

	useEffect(() => {
		const store = loadPresets(presetsFilePath(paths.configDir));
		if (store.data) {
			bus.emitState("LOG_LINE", {
				stream: "out",
				text: `[SYS] presets loaded: ${store.data.presets.length}`,
			});
		}
	}, []);

	function persistPresets(next: PresetFile): void {
		setPresetsFile(next);
		const store = loadPresets(presetsFilePath(paths.configDir));
		savePresets(presetsFilePath(paths.configDir), next, {
			migratedFrom: store.migratedFrom === 2 ? undefined : store.migratedFrom,
		});
	}

	useEffect(() => {
		const offLog = bus.onState("LOG_LINE", (event) => {
			setDrawer((s) =>
				appendLines(s, [{ text: event.text, stream: event.stream }]),
			);
		});
		const offProc = bus.onState("PROC_STATE", (event) => {
			setProcState(event.state);
			setTick((t) => t + 1);
		});
		const offTelemetry = bus.onState("TELEMETRY_STATE", (event) => {
			setTelemetry(event);
		});
		const offModels = bus.onState("MODELS_STATE", (event) => {
			setEntries(event.entries);
			setScanning(event.scanning);
			setScanError(event.error);
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
			offTelemetry();
			offModels();
			offDir();
			offConfirm();
			offConflict();
			offBlocked();
		};
	}, []);

	function selectedEntry(): ModelEntry | undefined {
		return entries[Math.min(selectedIndex, Math.max(entries.length - 1, 0))];
	}

	function selectModel(index: number): void {
		setSelectedIndex(index);
		const entry = entries[index];
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
					: 8080,
			presetId: "ad-hoc",
			host:
				typeof cfg.values.host === "string"
					? (cfg.values.host as string)
					: "127.0.0.1",
		};
	}
	planSource = buildPlan;
	const endpoint = `http://${typeof config.values.host === "string" ? config.values.host : DEFAULT_HOST}:${typeof config.values.port === "number" ? config.values.port : DEFAULT_PORT}`;
	if (telemetryService && telemetryEndpoint !== endpoint) {
		telemetryService.stop();
		telemetryService = null;
		metricsPoller = null;
	}
	if (!telemetryService && telemetryEnabled) {
		const metrics = new MetricsPoller({ url: `${endpoint}/metrics` });
		const service = createTelemetryService({
			supervisor: session.supervisor,
			health: new HealthPoller({ url: `${endpoint}/health` }),
			metrics,
			slots: new SlotsPoller({ url: `${endpoint}/slots` }),
		});
		service.onSnapshot((snapshot) =>
			bus.emitState("TELEMETRY_STATE", snapshot),
		);
		telemetryService = service;
		metricsPoller = metrics;
		telemetryEndpoint = endpoint;
		service.start();
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
				onUseDefaultDir: (dir: string) =>
					bus.emitIntent("SET_MODELS_DIR", { dir }),
			}}
			telemetryControl={{
				onEnableTelemetry: () => {
					setTelemetryEnabled((enabled) => !enabled);
				},
				vm: buildTelemetryViewModel({
					phase: telemetry.phase,
					model: config.model?.path ?? null,
					endpoint: telemetry.health
						? config.values.host && config.values.port
							? `http://${config.values.host}:${config.values.port}`
							: null
						: null,
					startedAtMs: procState === "IDLE" ? null : Date.now(),
					nowMs: Date.now(),
					telemetryEnabled,
					vramEstimatedBytes: vramRangeBytes(config),
					memUsedBytes: telemetry.metrics?.memUsedBytes ?? null,
					kvUsageRatio: telemetry.metrics?.kvUsageRatio ?? null,
					promptHistory: metricsPoller?.promptHistory.snapshot() ?? [],
					decodeHistory: metricsPoller?.decodeHistory.snapshot() ?? [],
					slots: telemetry.slots,
					failure: null,
					tailLines: [],
				}),
			}}
			configuratorControl={{
				state: config,
				setState: (next) => setConfig(next),
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
					setTelemetryEnabled((enabled) => {
						if (enabled) {
							telemetryService?.stop();
							telemetryService = null;
							metricsPoller = null;
						}
						return !enabled;
					});
				},
			}}
			serverRunning={procState !== "IDLE"}
		/>
	);
}
