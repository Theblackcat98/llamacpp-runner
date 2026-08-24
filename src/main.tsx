import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { useEffect, useState } from "react";
import { createBus } from "./core/bus";
import type { IntentMap, StateMap } from "./core/bus-contract";
import { createSession } from "./core/session";
import { resolvePaths } from "./core/store/state-paths";
import { App } from "./ui/app";
import {
	appendLines,
	createDrawerState,
	type DrawerState,
} from "./ui/logic/drawer-state";
import { TOKYO_NIGHT } from "./ui/theme";

const DRAWER_HEIGHT = 6;
const MODEL_PATH =
	process.env.LLAMA_DECK_MODEL_PATH ??
	`${process.env.HOME}/models/llm/model.gguf`;
const PORT = Number.parseInt(process.env.LLAMA_DECK_PORT ?? "8080", 10);
const NGL = Number.parseInt(process.env.LLAMA_DECK_NGL ?? "99", 10);

const bus = createBus<IntentMap, StateMap>();
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
	paths: resolvePaths(),
	bus,
});

await session.boot();
const renderer = await createCliRenderer();
createRoot(renderer).render(
	<SessionApp
		onQuit={() => {
			void session.shutdown().then(() => renderer.destroy());
		}}
	/>,
);

function SessionApp({ onQuit }: { onQuit: () => void }) {
	const [drawer, setDrawer] = useState<DrawerState>(() =>
		createDrawerState(DRAWER_HEIGHT),
	);
	const [, setTick] = useState(0);

	useEffect(() => {
		const offLog = bus.onState("LOG_LINE", (event) => {
			setDrawer((s) => appendLines(s, [event.text]));
		});
		const offProc = bus.onState("PROC_STATE", () => {
			setTick((t) => t + 1);
		});
		return () => {
			offLog();
			offProc();
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
		/>
	);
}
