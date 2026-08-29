import { existsSync, readFileSync } from "node:fs";
import { clearPidFile, type PidRecord, readPidFile } from "../store/pidfile";

export type OrphanStatus = "none" | "stale" | "alive";

export interface OrphanInspection {
	status: OrphanStatus;
	record?: PidRecord;
	portOpen?: boolean;
}

export interface OrphanTimings {
	sigintGraceMs: number;
	sigkillGraceMs: number;
}

export const DEFAULT_ORPHAN_TIMINGS: OrphanTimings = {
	sigintGraceMs: 5000,
	sigkillGraceMs: 2000,
};

function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "ESRCH") return false;
		return true;
	}
}

function cmdlineOf(pid: number): string[] | null {
	try {
		return readFileSync(`/proc/${pid}/cmdline`, "utf8")
			.split("\0")
			.filter(Boolean);
	} catch {
		return null;
	}
}

function looksLikeLlamaServer(pid: number): boolean {
	const argv = cmdlineOf(pid);
	if (!argv) return false;
	return argv.some((arg) => arg.endsWith("llama-server"));
}

async function portResponding(
	port: number,
	host = "127.0.0.1",
): Promise<boolean> {
	if (!port) return false;
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
): Promise<OrphanInspection> {
	const record = readPidFile(pidFile);
	if (!record) return { status: "none" };
	if (!processAlive(record.pid) || !looksLikeLlamaServer(record.pid)) {
		clearPidFile(pidFile);
		return { status: "stale", record };
	}
	return {
		status: "alive",
		record,
		portOpen: record.port ? await portResponding(record.port) : undefined,
	};
}

export async function killOrphan(
	pid: number,
	timings: OrphanTimings = DEFAULT_ORPHAN_TIMINGS,
): Promise<boolean> {
	if (!existsSync(`/proc/${pid}`)) return true;
	try {
		process.kill(pid, "SIGINT");
	} catch {
		return !existsSync(`/proc/${pid}`);
	}
	if (!(await waitFor(() => !processAlive(pid), timings.sigintGraceMs))) {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			return true;
		}
		await waitFor(() => !processGone(pid), timings.sigkillGraceMs);
	}
	return processGone(pid);
}

function processGone(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return false;
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === "ESRCH";
	}
}

async function waitFor(
	cond: () => boolean,
	timeoutMs: number,
): Promise<boolean> {
	const started = Date.now();
	while (!cond()) {
		if (Date.now() - started >= timeoutMs) return false;
		await new Promise((r) => setTimeout(r, 10));
	}
	return true;
}
