import { clearPidFile, type PidRecord, readPidFile } from "../store/pidfile";
import {
	defaultProcessInspector,
	isLlamaServerCommand,
	type ProcessInspector,
} from "./identity";

export type OrphanStatus = "none" | "stale" | "alive" | "unknown";
export interface OrphanInspection {
	status: OrphanStatus;
	record?: PidRecord;
	portOpen?: boolean;
	reason?: string;
}
export interface OrphanTimings {
	sigintGraceMs: number;
	sigkillGraceMs: number;
}
export const DEFAULT_ORPHAN_TIMINGS: OrphanTimings = {
	sigintGraceMs: 5000,
	sigkillGraceMs: 2000,
};
export interface OrphanOptions {
	inspector?: ProcessInspector;
	probePort?: (port: number, host?: string) => Promise<boolean>;
}

async function portResponding(
	port: number,
	host = "127.0.0.1",
): Promise<boolean> {
	try {
		const socket = await Bun.connect({
			hostname: host,
			port,
			socket: { data() {}, close() {}, error() {} },
		});
		socket.end();
		return true;
	} catch {
		return false;
	}
}

export async function inspectOrphan(
	pidFile: string,
	options: OrphanOptions = {},
): Promise<OrphanInspection> {
	const record = readPidFile(pidFile);
	if (!record) return { status: "none" };
	const inspector = options.inspector ?? defaultProcessInspector();
	const observed = inspector.inspect(record.pid);
	if (observed === "dead") {
		clearPidFile(pidFile, record);
		return { status: "stale", record };
	}
	if (observed === "unknown")
		return {
			status: "unknown",
			record,
			reason: "process identity unavailable",
		};
	if (typeof observed === "string")
		return {
			status: "unknown",
			record,
			reason: "process identity unavailable",
		};
	if (!isLlamaServerCommand(observed.command)) {
		clearPidFile(pidFile, record);
		return {
			status: "stale",
			record,
			reason: "pid belongs to another command",
		};
	}
	const portOpen = record.port
		? await (options.probePort ?? portResponding)(record.port)
		: undefined;
	return { status: "alive", record, portOpen };
}

export async function killOrphan(
	pid: number,
	timings: OrphanTimings = DEFAULT_ORPHAN_TIMINGS,
	inspector: ProcessInspector = defaultProcessInspector(),
): Promise<boolean> {
	if (inspector.canSignal && !inspector.canSignal(pid)) {
		const observed = inspector.inspect(pid);
		return observed === "dead";
	}
	try {
		process.kill(pid, "SIGINT");
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ESRCH";
	}
	if (!(await waitFor(() => !isAlive(pid), timings.sigintGraceMs))) {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			return true;
		}
		await waitFor(() => !isAlive(pid), timings.sigkillGraceMs);
	}
	return !isAlive(pid);
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ESRCH";
	}
}
async function waitFor(
	condition: () => boolean,
	timeoutMs: number,
): Promise<boolean> {
	const started = Date.now();
	while (!condition()) {
		if (Date.now() - started >= timeoutMs) return false;
		await Bun.sleep(10);
	}
	return true;
}
