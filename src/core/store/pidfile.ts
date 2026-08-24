import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export interface PidRecord {
	pid: number;
	port?: number;
	presetId?: string;
	startedAt: string;
}

export function ensureDir(dir: string): void {
	mkdirSync(dir, { recursive: true });
}

export function writePidFile(file: string, record: PidRecord): void {
	ensureDir(dirname(file));
	const tmp = join(dirname(file), `.server.pid.tmp-${process.pid}`);
	writeFileSync(tmp, `${JSON.stringify(record, null, "\t")}\n`);
	renameSync(tmp, file);
}

export function readPidFile(file: string): PidRecord | null {
	if (!existsSync(file)) return null;
	try {
		const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			typeof (parsed as PidRecord).pid !== "number" ||
			typeof (parsed as PidRecord).startedAt !== "string"
		) {
			return null;
		}
		return parsed as PidRecord;
	} catch {
		return null;
	}
}

export function clearPidFile(file: string): void {
	rmSync(file, { force: true });
}
