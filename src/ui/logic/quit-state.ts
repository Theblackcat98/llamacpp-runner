/**
 * Quit/kill confirmation semantics (§4, P5-FR-11): Ctrl+C quits AND tears
 * down — confirmation when a server is running, second press within 2 s
 * force-quits. x = explicit kill with its own confirmation.
 */

export type ConfirmKind = "quit" | "kill" | "host";

export interface QuitState {
	pending: ConfirmKind | null;
	armedAt: number | null;
}

export interface ConfirmWindow {
	confirmWindowMs: number;
}

const DEFAULTS: ConfirmWindow = { confirmWindowMs: 2000 };

export function createQuitState(): QuitState {
	return { pending: null, armedAt: null };
}

export type ConfirmAction =
	| { action: "none"; state: QuitState }
	| { action: "confirm"; message?: string; state: QuitState }
	| { action: "quit"; state: QuitState }
	| { action: "execute"; state: QuitState };

function armed(kind: ConfirmKind, now: number): ConfirmAction {
	return {
		action: "confirm",
		message:
			kind === "quit"
				? "server running — Ctrl+C again within 2s to quit"
				: kind === "kill"
					? "kill running server — press x again to confirm"
					: "host binds ALL interfaces — press Ctrl+Y again to confirm",
		state: { pending: kind, armedAt: now },
	};
}

export function handleQuitKey(
	state: QuitState,
	nowMs: number,
	serverRunning: boolean,
	opts?: Partial<ConfirmWindow>,
): ConfirmAction {
	const window = { ...DEFAULTS, ...opts }.confirmWindowMs;
	if (!serverRunning) return { action: "quit", state: createQuitState() };
	if (
		state.pending === "quit" &&
		state.armedAt !== null &&
		nowMs - state.armedAt <= window
	) {
		return { action: "quit", state: createQuitState() };
	}
	return armed("quit", nowMs);
}

export function handleKillKey(
	state: QuitState,
	nowMs: number,
	serverRunning: boolean,
	opts?: Partial<ConfirmWindow>,
): ConfirmAction {
	const window = { ...DEFAULTS, ...opts }.confirmWindowMs;
	if (!serverRunning) return { action: "none", state: createQuitState() };
	if (
		state.pending === "kill" &&
		state.armedAt !== null &&
		nowMs - state.armedAt <= window
	) {
		return { action: "execute", state: createQuitState() };
	}
	return armed("kill", nowMs);
}

/**
 * Phase 13: host-exposure confirmation (P5-FR-11) — Ctrl+Y arms, a second
 * Ctrl+Y within the window executes; the launch itself is never implicit.
 */
export function handleHostKey(
	state: QuitState,
	nowMs: number,
	opts?: Partial<ConfirmWindow>,
): ConfirmAction {
	const window = { ...DEFAULTS, ...opts }.confirmWindowMs;
	if (
		state.pending === "host" &&
		state.armedAt !== null &&
		nowMs - state.armedAt <= window
	) {
		return { action: "execute", state: createQuitState() };
	}
	return armed("host", nowMs);
}
