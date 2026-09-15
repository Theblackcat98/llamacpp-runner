import type { ModelEntry } from "./models/types";
import type { TelemetrySnapshot } from "./telemetry/service";

export type ProcState = "IDLE" | "STARTING" | "LOADING" | "READY" | "FAILED";

export interface LaunchIntent {
	presetId: string;
	/** P4-FR-09: user acknowledged the 0.0.0.0 bind confirmation. */
	confirmedHost?: boolean;
}

export interface ProcStateEvent {
	state: ProcState;
	detail?: string;
	exitCode?: number;
	tail?: string[];
	startedAtMs?: number | null;
}

export interface LogLineEvent {
	stream: "out" | "err";
	text: string;
}

export interface OrphanFoundEvent {
	pid: number;
	port?: number;
	presetId?: string;
	startedAt?: string;
}

/** P3-FR-17: persist the user's model directory to config. */
export interface SetModelsDirIntent {
	dir: string;
}

/** P3-FR-19: manual "Rescan Models Directory". */
export type RescanIntent = Record<string, never>;

export interface ModelsStateEvent {
	entries: ModelEntry[];
	scanning: boolean;
	dir?: string | null;
	error?: string;
}

export interface ModelsDirEvent {
	dir: string | null;
}

/** P4-FR-20: second launch while an instance is running (D4). */
export interface LaunchBlockedEvent {
	reason: "instance_running";
}

/** P4-FR-09: 0.0.0.0 bind needs explicit user confirmation before spawn. */
export interface ConfirmRequiredEvent {
	host: string;
}

/** P4-FR-10: pre-flight bind check failed; suggest next free port (§7). */
export interface PortConflictEvent {
	requested: number;
	suggested?: number;
}

/** P5-FR-07: classified failure from exit code + log patterns (§6.4). */
export interface FailureClassifiedEvent {
	kind: string;
	summary: string;
	suggestion: string;
}

export interface IntentMap {
	LAUNCH: LaunchIntent;
	KILL: Record<string, never>;
	QUIT: Record<string, never>;
	SET_MODELS_DIR: SetModelsDirIntent;
	RESCAN: RescanIntent;
}

export interface StateMap {
	LOG_LINE: LogLineEvent;
	PROC_STATE: ProcStateEvent;
	ORPHAN_FOUND: OrphanFoundEvent;
	MODELS_STATE: ModelsStateEvent;
	MODELS_DIR: ModelsDirEvent;
	LAUNCH_BLOCKED: LaunchBlockedEvent;
	CONFIRM_REQUIRED: ConfirmRequiredEvent;
	PORT_CONFLICT: PortConflictEvent;
	FAILURE_CLASSIFIED: FailureClassifiedEvent;
	TELEMETRY_STATE: TelemetrySnapshot;
}
