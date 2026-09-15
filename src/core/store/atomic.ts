import {
	closeSync,
	fsyncSync,
	mkdirSync,
	openSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

export interface AtomicWriteOptions {
	durable?: boolean;
	writeFile?: (path: string, data: string) => void;
	rename?: (from: string, to: string) => void;
	fsync?: (path: string) => void;
}

function tempPath(target: string): string {
	return join(
		dirname(target),
		`.${basename(target) || "file"}.tmp-${process.pid}-${crypto.randomUUID()}`,
	);
}

function syncFile(path: string): void {
	const fd = openSync(path, "r");
	try {
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}

export function atomicWrite(
	target: string,
	data: string,
	options: AtomicWriteOptions = {},
): void {
	mkdirSync(dirname(target), { recursive: true });
	const temporary = tempPath(target);
	const write =
		options.writeFile ?? ((path, value) => writeFileSync(path, value));
	const rename = options.rename ?? renameSync;
	try {
		write(temporary, data);
		if (options.durable) (options.fsync ?? syncFile)(temporary);
		rename(temporary, target);
		if (options.durable) (options.fsync ?? syncFile)(dirname(target));
	} catch (error) {
		try {
			unlinkSync(temporary);
		} catch {
			// Preserve the original error; an interrupted temp is recoverable.
		}
		throw error;
	}
}
