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

export interface IntentMap {
	LAUNCH: LaunchIntent;
	KILL: Record<string, never>;
	QUIT: Record<string, never>;
}

export interface StateMap {
	LOG_LINE: LogLineEvent;
	PROC_STATE: ProcStateEvent;
	ORPHAN_FOUND: OrphanFoundEvent;
}
