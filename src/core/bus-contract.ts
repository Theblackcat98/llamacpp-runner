import type { ModelEntry } from "./models/types";

export type ProcState = "IDLE" | "STARTING" | "LOADING" | "READY" | "FAILED";

export interface LaunchIntent {
	presetId: string;
}

export interface ProcStateEvent {
	state: ProcState;
	detail?: string;
	exitCode?: number;
	tail?: string[];
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
	error?: string;
}

export interface ModelsDirEvent {
	dir: string | null;
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
}
