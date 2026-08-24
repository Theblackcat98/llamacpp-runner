import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { useEffect, useState } from "react";
import { createBus } from "./core/bus";
import type { IntentMap, StateMap } from "./core/bus-contract";
import { copyToClipboard } from "./core/export/clipboard";
import { createModelsService } from "./core/models/service";
import type { ModelEntry } from "./core/models/types";
import { createSession } from "./core/session";
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
	previewLine,
} from "./ui/logic/configurator-state";
import {
	appendLines,
	createDrawerState,
	type DrawerState,
} from "./ui/logic/drawer-state";
import { TOKYO_NIGHT } from "./ui/themes";

const DRAWER_HEIGHT = 6;

const bus = createBus<IntentMap, StateMap>();
const paths = resolvePaths();
const session = createSession({
	command: "llama-server",
	args: ["--version"],
	port: 8080,
	presetId: "unconfigured",
	paths,
	bus,
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
		return () => {
			offLog();
			offProc();
			offModels();
			offDir();
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

	function handleLaunch(): void {
		const entry = selectedEntry();
		if (!entry || !config.model) return;
		bus.emitIntent("LAUNCH", { presetId: "ad-hoc" });
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
		/>
	);
}
