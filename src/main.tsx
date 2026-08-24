import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { useEffect, useState } from "react";
import { createBus } from "./core/bus";
import type { IntentMap, StateMap } from "./core/bus-contract";
import { copyToClipboard } from "./core/export/clipboard";
import { buildCommand } from "./core/flags/builder";
import { createModelsService } from "./core/models/service";
import type { ModelEntry } from "./core/models/types";
import { createSession, type LaunchPlan } from "./core/session";
import type { PresetFile } from "./core/store/presets";
import {
	loadPresets,
	presetsFilePath,
	savePresets,
} from "./core/store/presets";
import { resolvePaths } from "./core/store/state-paths";
import { App } from "./ui/app";
import {
	type ConfiguratorState,
	clampContext,
	createConfigurator,
	effectiveValues,
	previewLine,
} from "./ui/logic/configurator-state";
import {
	appendLines,
	createDrawerState,
	type DrawerState,
} from "./ui/logic/drawer-state";
import {
	clonePreset,
	deletePreset,
	setDefault,
} from "./ui/logic/presets-state";
import { TOKYO_NIGHT } from "./ui/themes";

const DRAWER_HEIGHT = 6;

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

const renderer = await createCliRenderer();
createRoot(renderer).render(
	<SessionApp
		onQuit={() => {
			modelsService.dispose();
			void session.shutdown().then(() => renderer.destroy());
		}}
	/>,
);

function SessionApp({ onQuit }: { onQuit: () => void }) {
	const [drawer, setDrawer] = useState<DrawerState>(() =>
		createDrawerState(DRAWER_HEIGHT),
	);
	const [, setTick] = useState(0);
	const [entries, setEntries] = useState<ModelEntry[]>([]);
	const [scanning, setScanning] = useState(false);
	const [scanError, setScanError] = useState<string | undefined>(undefined);
	const [modelsDir, setModelsDir] = useState<string | null>(null);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [config, setConfig] = useState<ConfiguratorState>(() =>
		createConfigurator(null),
	);
	const [presetsFile, setPresetsFile] = useState<PresetFile>(() => ({
		version: 2,
		presets: [],
	}));

	useEffect(() => {
		const store = loadPresets(presetsFilePath(paths.configDir));
		if (store.data) {
			setPresetsFile(store.data);
			// lastSession restores last preset+tab on boot (P4-FR-19).
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
			setDrawer((s) => appendLines(s, [event.text]));
		});
		const offProc = bus.onState("PROC_STATE", () => {
			setTick((t) => t + 1);
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
			command: "llama-server",
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

	function handleLaunch(): void {
		bus.emitIntent("LAUNCH", { presetId: "ad-hoc" });
	}

	function handleConfirmHost(): void {
		bus.emitIntent("LAUNCH", { presetId: "ad-hoc", confirmedHost: true });
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
			theme={TOKYO_NIGHT}
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
			configuratorControl={{
				state: config,
				setState: (next) => setConfig(next),
			}}
			presetsControl={{
				file: presetsFile,
				existingModelPaths: new Set(entries.map((e) => e.path)),
				onClone: (id) => persistPresets(clonePreset(presetsFile, id)),
				onDelete: (id) => persistPresets(deletePreset(presetsFile, id)),
				onSetDefault: (id) => persistPresets(setDefault(presetsFile, id, 3)),
			}}
		/>
	);
}
