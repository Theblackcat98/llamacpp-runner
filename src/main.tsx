import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { useEffect, useState } from "react";
import { createBus } from "./core/bus";
import type { IntentMap, StateMap } from "./core/bus-contract";
import { createModelsService } from "./core/models/service";
import type { ModelEntry } from "./core/models/types";
import { createSession } from "./core/session";
import { resolvePaths } from "./core/store/state-paths";
import { App } from "./ui/app";
import {
	appendLines,
	createDrawerState,
	type DrawerState,
} from "./ui/logic/drawer-state";
import { TOKYO_NIGHT } from "./ui/themes";

const DRAWER_HEIGHT = 6;
const MODEL_PATH =
	process.env.LLAMA_DECK_MODEL_PATH ??
	`${process.env.HOME}/models/llm/model.gguf`;
const PORT = Number.parseInt(process.env.LLAMA_DECK_PORT ?? "8080", 10);
const NGL = Number.parseInt(process.env.LLAMA_DECK_NGL ?? "99", 10);

const bus = createBus<IntentMap, StateMap>();
const paths = resolvePaths();
const session = createSession({
	command: "llama-server",
	args: [
		"-m",
		MODEL_PATH,
		"--host",
		"127.0.0.1",
		"--port",
		String(PORT),
		"-ngl",
		String(NGL),
	],
	port: PORT,
	presetId: "hardcoded-phase1",
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

	return (
		<App
			theme={TOKYO_NIGHT}
			onQuit={onQuit}
			onLaunch={() =>
				bus.emitIntent("LAUNCH", { presetId: "hardcoded-phase1" })
			}
			onKill={() => bus.emitIntent("KILL", {})}
			onKillOrphan={() => {
				void session.killFoundOrphan().then(() => setTick((t) => t + 1));
			}}
			drawerControl={{ state: drawer, setState: setDrawer }}
			explorerControl={{
				entries,
				scanning,
				modelsDir,
				scanError,
				onRescan: () => bus.emitIntent("RESCAN", {}),
				onUseDefaultDir: (dir: string) =>
					bus.emitIntent("SET_MODELS_DIR", { dir }),
			}}
		/>
	);
}
