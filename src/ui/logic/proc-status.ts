/**
 * Process-state classification for the shell header (#56): FAILED is a
 * terminal state with a dead supervisor — it must never render as "server
 * running" and must never trigger quit/kill confirmations.
 */
import type { ProcState } from "../../core/bus-contract";

export type HeaderTone = "success" | "error" | "muted";

export interface HeaderStatus {
	label: string;
	tone: HeaderTone;
}

/** A live server occupies the supervisor only in these states (#56). */
export function serverIsRunning(state: ProcState): boolean {
	return state === "STARTING" || state === "LOADING" || state === "READY";
}

/** Header status line: FAILED renders an error tone, never "running". */
export function headerStatus(running: boolean, failed: boolean): HeaderStatus {
	if (failed) return { label: "server failed", tone: "error" };
	if (running) return { label: "server running", tone: "success" };
	return { label: "idle", tone: "muted" };
}
