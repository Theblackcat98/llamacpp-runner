import { useEffect, useReducer, useState } from "react";
import type { createBus } from "../../core/bus";
import type { IntentMap, ProcState, StateMap } from "../../core/bus-contract";
import type { createSession } from "../../core/session";

type Bus = ReturnType<typeof createBus<IntentMap, StateMap>>;
type Session = ReturnType<typeof createSession>;

export interface FailureInfo {
	summary: string;
	suggestion?: string;
}

/**
 * Issue #70: process-lifecycle state extracted from SessionApp — the
 * PROC_STATE / FAILURE_CLASSIFIED subscriptions and the state they feed
 * (header status, telemetry uptime, failure panel inputs).
 *
 * `refresh` replaces the old manual setTick: it forces a re-render when
 * something outside React changed identity (the orphan-kill path reads
 * session.foundOrphanPid after an async kill).
 */
export function useProcState(bus: Bus, session: Session) {
	const [procState, setProcState] = useState<ProcState>("IDLE");
	const [procStartedAtMs, setProcStartedAtMs] = useState<number | null>(null);
	const [failure, setFailure] = useState<FailureInfo | null>(null);
	const [tailLines, setTailLines] = useState<string[]>([]);
	const [, bump] = useReducer((n: number) => n + 1, 0);

	// biome-ignore lint/correctness/useExhaustiveDependencies: subscriptions are bound on mount
	useEffect(() => {
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
			bump();
		});
		const offFailure = bus.onState("FAILURE_CLASSIFIED", (event) => {
			setFailure({ summary: event.summary, suggestion: event.suggestion });
		});
		return () => {
			offProc();
			offFailure();
		};
	}, []);

	return {
		procState,
		procStartedAtMs,
		failure,
		tailLines,
		refresh: bump as () => void,
	};
}
