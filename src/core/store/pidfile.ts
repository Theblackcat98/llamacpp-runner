import { existsSync, readFileSync, rmSync } from "node:fs";
import { atomicWrite } from "./atomic";

export interface PidRecord {
	pid: number;
	port?: number;
	presetId?: string;
	startedAt: string;
}

export function ensureDir(dir: string): void {
	// atomicWrite creates the parent directory; retained for callers.
	void dir;
}

export function writePidFile(file: string, record: PidRecord): void {
	if (!isPidRecord(record)) throw new Error("invalid pid record");
	atomicWrite(file, `${JSON.stringify(record, null, "\t")}\n`);
}

export function readPidFile(file: string): PidRecord | null {
	if (!existsSync(file)) return null;
	try {
		const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
		return isPidRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export function clearPidFile(file: string, expected?: PidRecord): boolean {
	if (expected) {
		const current = readPidFile(file);
		if (!current || JSON.stringify(current) !== JSON.stringify(expected))
			return false;
	}
	rmSync(file, { force: true });
	return true;
}

function isPidRecord(value: unknown): value is PidRecord {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	return (
		Number.isInteger(record.pid) &&
		(record.pid as number) > 0 &&
		typeof record.startedAt === "string" &&
		(record.port === undefined ||
			(Number.isInteger(record.port) &&
				(record.port as number) > 0 &&
				(record.port as number) <= 65535)) &&
		(record.presetId === undefined || typeof record.presetId === "string")
	);
}
