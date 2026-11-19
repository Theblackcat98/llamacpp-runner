import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { useRef, useState } from "react";
import { createBus } from "./core/bus";
import type { IntentMap, StateMap } from "./core/bus-contract";
import { createModelsService } from "./core/models/service";
import { createSession, type LaunchPlan } from "./core/session";
import { loadConfig, saveConfig } from "./core/store/config";
import { type AppPaths, resolvePaths } from "./core/store/state-paths";
import { App } from "./ui/app";
import { useBinaryCapability } from "./ui/hooks/use-binary-capability";
import { useBootState, useHardware } from "./ui/hooks/use-boot-state";
import { useConsoleLog } from "./ui/hooks/use-console-log";
import {
	resolveDefaultLaunchPlan,
	useLaunchPlan,
} from "./ui/hooks/use-launch-plan";
import { useModelsReconciliation } from "./ui/hooks/use-models-reconciliation";
import { usePresetStore } from "./ui/hooks/use-preset-store";
import { useProcState } from "./ui/hooks/use-proc-state";
import {
	stopBoundTelemetry,
	useTelemetryBinding,
} from "./ui/hooks/use-telemetry-binding";
import {
	type ConfiguratorState,
	createConfigurator,
	loadPresetInto,
	setFlag,
	solveAutoFitNgl,
	vramRangeBytes,
} from "./ui/logic/configurator-state";
import { serverIsRunning } from "./ui/logic/proc-status";
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
const defaultPaths: AppPaths = resolvePaths();

const defaultSession = createSession({
	paths: defaultPaths,
	bus: defaultBus,
	resolveLaunch: resolveDefaultLaunchPlan,
});

// Do not implicitly scan the application working tree. A checkout/build of
// llama.cpp commonly lives beside the app and may contain unrelated GGUF test
// files. Discovery starts only from the persisted models directory (or the
// configured presets default); users can choose a directory with [m].
const defaultModelsService = createModelsService(defaultBus, defaultPaths);

export interface SessionAppProps {
	bus?: ReturnType<typeof createBus<IntentMap, StateMap>>;
	paths?: AppPaths;
	session?: ReturnType<typeof createSession>;
	modelsService?: ReturnType<typeof createModelsService>;
	onQuit?: () => void;
	setPlanSource?: (fn: () => LaunchPlan | null) => void;
}

/**
 * Composition root (Issue #70): SessionApp wires the hooks together and
 * renders <App>. All stateful concerns live in src/ui/hooks/ —
 * useBootState (one-shot boot load), useConsoleLog (drawer + log
 * subscriptions), useProcState (process lifecycle), useModelsReconciliation
 * (library ↔ configurator), usePresetStore (preset persistence),
 * useBinaryCapability (Issue #15 probe), useLaunchPlan (plan building +
 * registration), useTelemetryBinding (Issue #16/#70 poller binding).
 */
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

	const initialState = useBootState(paths);
	const { hardware, reprobeHardware } = useHardware(
		paths,
		initialState.configFile.hardware ?? null,
		bus,
	);

	const [config, setConfig] = useState<ConfiguratorState>(() => {
		const base = createConfigurator(null);
		// lastSession restores the last preset into the configurator on boot
		// (P4-FR-19); applied in the initializer so no post-mount effect is
		// needed to converge on the restored state.
		if (!initialState.preset) return base;
		const restored = loadPresetInto(
			base,
			initialState.preset.flags ?? {},
			initialState.preset.model_path,
		);
		// #64: a restored preset stays attributable for last_used stamps.
		restored.sourcePresetId = initialState.preset.id;
		return restored;
	});
	const configRef = useRef(config);
	configRef.current = config;
	const [themeName, setThemeName] = useState<ThemeName>(() => {
		const saved =
			initialState.configFile.theme ?? initialState.presetStore?.theme;
		return (themeByName(saved ?? "").name as ThemeName) ?? DEFAULT_THEME.name;
	});
	const [telemetryEnabled, setTelemetryEnabled] = useState(true);

	// Hook order matters: useConsoleLog subscribes LOG_LINE before
	// useModelsReconciliation emits the boot RESCAN (#59).
	const { drawer, setDrawer } = useConsoleLog(bus, initialState);
	const proc = useProcState(bus, session);
	const models = useModelsReconciliation({
		bus,
		initialModelsDir: initialState.configFile.modelsDir ?? null,
		configRef,
		setConfig,
	});
	const presets = usePresetStore({
		paths,
		bus,
		initialPresetStore: initialState.presetStore,
		config,
		setConfig,
		entries: models.entries,
	});
	// #69: binary path is owned by config.json; the presets file-level
	// field is only the pre-migration fallback.
	const configuredBinaryPath =
		initialState.configFile.binaryPath ?? presets.presetsFile.binary_path;
	const capability = useBinaryCapability(bus, configuredBinaryPath);
	const plan = useLaunchPlan({
		bus,
		config,
		capability,
		configuredBinaryPath,
		setPlanSource,
	});
	const telemetryBinding = useTelemetryBinding({
		bus,
		session,
		procState: proc.procState,
		telemetryEnabled,
	});

	function handleLaunch(): void {
		// #60: a vanished model launches nothing — prompt to relink instead.
		if (config.model?.stale) {
			bus.emitState("LOG_LINE", {
				stream: "out",
				text: "[SYS] model file missing — relink in Explorer first",
			});
			return;
		}
		if (plan.launchSplitDiagnostic()) return;
		// #64: a launch from a preset stamps its last_used — the Presets
		// column reflects reality, not a permanent "never".
		if (config.sourcePresetId) {
			presets.markLaunchUsed(config.sourcePresetId);
		}
		bus.emitIntent("LAUNCH", { presetId: "ad-hoc" });
	}

	/** F4: apply + persist the theme so palette switching is reachable. */
	function switchTheme(name: string): void {
		const next = themeByName(name);
		setThemeName(next.name as ThemeName);
		const current = loadConfig(paths.configDir);
		saveConfig(paths.configDir, { ...current, theme: next.name });
		bus.emitState("LOG_LINE", {
			stream: "out",
			text: `[SYS] theme switched to ${next.name}`,
		});
	}

	function handleConfirmHost(): void {
		if (plan.launchSplitDiagnostic()) return;
		bus.emitIntent("LAUNCH", { presetId: "ad-hoc", confirmedHost: true });
	}

	function handleAutoFit(): void {
		if (!config.model) return;
		const res = solveAutoFitNgl(config, hardware);
		setConfig((s) => setFlag(s, "n_gpu_layers", res.ngl));
		bus.emitState("LOG_LINE", {
			stream: "out",
			text: res.fits
				? `[SYS] auto-fit solved ngl=${res.ngl}`
				: `[SYS] auto-fit warning: ${res.message ?? "cannot fit in VRAM"}`,
		});
	}

	const { telemetry } = telemetryBinding;

	return (
		<App
			theme={themeByName(themeName)}
			initialTab={clampTab(initialState.last?.tab)}
			onQuit={onQuit}
			onLaunch={handleLaunch}
			onKill={() => bus.emitIntent("KILL", {})}
			onKillOrphan={() => {
				void session.killFoundOrphan().then(() => proc.refresh());
			}}
			onSavePreset={presets.savePreset}
			onYankCommand={plan.yankCommand}
			onConfirmHost={handleConfirmHost}
			drawerControl={{ state: drawer, setState: setDrawer }}
			explorerControl={{
				entries: models.entries,
				scanning: models.scanning,
				modelsDir: models.modelsDir,
				scanError: models.scanError,
				selectedIndex: models.selectedIndex,
				onSelectIndex: models.selectModel,
				onRescan: models.rescan,
				onSetModelsDir: models.setModelsDir,
			}}
			telemetryControl={{
				onEnableTelemetry: () => {
					setTelemetryEnabled((enabled) => !enabled);
				},
				vm: buildTelemetryViewModel({
					phase: telemetry.phase,
					model: config.model?.path ?? null,
					endpoint: telemetry.health ? telemetryBinding.endpoint || null : null,
					startedAtMs:
						proc.procState === "IDLE"
							? null
							: (proc.procStartedAtMs ??
								session.supervisor?.startedAtMs ??
								null),
					nowMs: Date.now(),
					telemetryEnabled,
					vramEstimatedBytes: vramRangeBytes(config),
					memUsedBytes: telemetry.metrics?.memUsedBytes ?? null,
					kvUsageRatio: telemetry.metrics?.kvUsageRatio ?? null,
					promptHistory: telemetryBinding.promptHistory(),
					decodeHistory: telemetryBinding.decodeHistory(),
					slots: telemetry.slots,
					failure: proc.failure,
					tailLines: proc.tailLines,
				}),
			}}
			configuratorControl={{
				state: config,
				setState: (next) => setConfig(next),
				previewCommand: plan.launchPreview,
				hardware,
				onAutoFit: handleAutoFit,
				availability: capability?.availability,
			}}
			presetsControl={{
				file: presets.presetsFile,
				existingModelPaths: new Set(models.entries.map((e) => e.path)),
				onClone: presets.clone,
				onDelete: presets.remove,
				onSetDefault: presets.setDefaultPreset,
				onLoad: presets.loadPreset,
				onRelink: presets.relinkPreset,
			}}
			paletteControl={{
				switchTheme,
				toggleTelemetry: () => {
					// The telemetry binding binds/disposes on this flag — no
					// direct service handling here (Issue #16).
					setTelemetryEnabled((enabled) => !enabled);
				},
				reprobeHardware,
			}}
			serverRunning={serverIsRunning(proc.procState)}
			serverFailed={proc.procState === "FAILED"}
			foundOrphanPid={session.foundOrphanPid ?? null}
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
				stopBoundTelemetry();
				void defaultSession.shutdown().then(() => renderer.destroy());
			}}
		/>,
	);
}
