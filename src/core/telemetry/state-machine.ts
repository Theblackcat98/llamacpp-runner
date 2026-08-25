/**
 * Telemetry state machine (§3.5, P5-FR-01): pure reducer merging three input
 * sources — spawn lifecycle, /health poll results, exit-code watch — into the
 * badge timeline STARTING → LOADING → READY | FAILED.
 */

import type { Supervisor } from "../process/supervisor";
import type { HealthStatus } from "./health";

export type TelemetryPhase =
	| "IDLE"
	| "STARTING"
	| "LOADING"
	| "READY"
	| "FAILED";

export type TelemetryInput =
	| { type: "spawned" }
	| { type: "health"; status: HealthStatus }
	| { type: "log_ready" }
	| { type: "exited"; code: number; signal: string | null };

export function transition(
	phase: TelemetryPhase,
	input: TelemetryInput,
): TelemetryPhase {
	switch (phase) {
		case "IDLE":
			return input.type === "spawned" ? "STARTING" : phase;
		case "FAILED":
			return phase; // terminal until reset
		case "STARTING":
		case "LOADING": {
			if (input.type === "health") {
				return input.status === "ready"
					? "READY"
					: input.status === "loading"
						? "LOADING"
						: phase;
			}
			if (input.type === "log_ready") return "READY";
			if (input.type === "exited") return exitPhase(input);
			return phase;
		}
		case "READY": {
			// sticky READY: a 503 after readiness never demotes (§3.5)
			if (input.type !== "exited") return phase;
			return exitPhase(input);
		}
	}
}

function exitPhase(
	input: Extract<TelemetryInput, { type: "exited" }>,
): TelemetryPhase {
	if (input.signal !== null) return "IDLE"; // user-initiated kill is not a failure
	return input.code === 0 ? "IDLE" : "FAILED";
}

export interface TelemetryMonitor {
	readonly phase: TelemetryPhase;
	onChange(cb: (phase: TelemetryPhase) => void): () => void;
	stop(): void;
}

/**
 * Wires a supervisor + health poller into the state machine. Supervisor state
 * events map onto inputs (spawn/LOADING/log-marker/exit); health samples feed
 * the /health-driven transitions.
 */
export function createTelemetryMonitor(opts: {
	supervisor: Supervisor;
	health: { onStatus(cb: (s: { status: HealthStatus }) => void): () => void };
}): TelemetryMonitor {
	let phase: TelemetryPhase = "IDLE";
	const listeners = new Set<(p: TelemetryPhase) => void>();
	const unsubs: (() => void)[] = [];

	const apply = (input: TelemetryInput) => {
		const next = transition(phase, input);
		if (next === phase) return;
		phase = next;
		for (const cb of [...listeners]) cb(phase);
	};

	unsubs.push(
		opts.supervisor.onState((e) => {
			switch (e.state) {
				case "STARTING":
					apply({ type: "spawned" });
					break;
				case "LOADING":
					apply({ type: "health", status: "loading" });
					break;
				case "READY":
					apply({ type: "log_ready" });
					break;
				case "FAILED":
				case "IDLE":
					apply({
						type: "exited",
						code: e.exitCode ?? 0,
						signal:
							e.detail === undefined && e.state === "IDLE" ? "SIGINT" : null,
					});
					break;
			}
		}),
	);
	unsubs.push(
		opts.health.onStatus((s) => apply({ type: "health", status: s.status })),
	);

	return {
		get phase() {
			return phase;
		},
		onChange(cb) {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		stop() {
			for (const u of unsubs) u();
		},
	};
}
