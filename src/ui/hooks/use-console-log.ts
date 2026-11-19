import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import type { createBus } from "../../core/bus";
import type { IntentMap, StateMap } from "../../core/bus-contract";
import { DRAWER_HEIGHT } from "../constants";
import {
	appendLines,
	createDrawerState,
	type DrawerState,
} from "../logic/drawer-state";
import type { BootState } from "./use-boot-state";

type Bus = ReturnType<typeof createBus<IntentMap, StateMap>>;

/**
 * Issue #70: console drawer state + the log-facing bus subscriptions,
 * extracted from SessionApp. Owns LOG_LINE (drawer append) plus the
 * launch-guard announcements (CONFIRM_REQUIRED / PORT_CONFLICT /
 * LAUNCH_BLOCKED) that translate state events into drawer lines.
 *
 * Boot announcements live here on purpose: effects run in hook-call
 * order, and SessionApp calls this hook before useModelsReconciliation
 * emits the boot RESCAN — so every line emitted at boot lands in a
 * drawer that is already subscribed (#59: the old standalone presets
 * effect lost its lines because it ran before the subscription existed).
 */
export function useConsoleLog(
	bus: Bus,
	initialState: BootState,
): {
	drawer: DrawerState;
	setDrawer: Dispatch<SetStateAction<DrawerState>>;
} {
	const [drawer, setDrawer] = useState<DrawerState>(() =>
		createDrawerState(DRAWER_HEIGHT),
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: subscriptions are bound on mount; boot announcements read the one-shot boot state
	useEffect(() => {
		const offLog = bus.onState("LOG_LINE", (event) => {
			setDrawer((s) =>
				appendLines(s, [{ text: event.text, stream: event.stream }]),
			);
		});
		// The boot load itself ran in useBootState's initializer; here we
		// only announce what it found, including the corrupt-file
		// backup (#59).
		if (initialState.corruptBackup) {
			bus.emitState("LOG_LINE", {
				stream: "err",
				text: `[ERR] presets.json was unreadable — original preserved at ${initialState.corruptBackup}`,
			});
		}
		if (initialState.presetStore) {
			bus.emitState("LOG_LINE", {
				stream: "out",
				text: `[SYS] presets loaded: ${initialState.presetStore.presets.length}`,
			});
		}
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
			offConfirm();
			offConflict();
			offBlocked();
		};
	}, []);

	return { drawer, setDrawer };
}
