/**
 * Binary resolution + runtime --help capture (§7, P4-FR-05).
 * "llama-server not on PATH" -> missing status; callers prompt for a path and
 * persist it (config store). Registry validation idles until resolved.
 */
import { accessSync, constants } from "node:fs";

export type BinaryStatus =
	| { status: "ok"; path: string }
	| { status: "missing" };

export interface ResolveBinaryOptions {
	configured?: string;
	whichFn?: (command: string) => string | null;
}

export function resolveBinaryPath(
	opts: ResolveBinaryOptions = {},
): BinaryStatus {
	const which = opts.whichFn ?? ((c) => Bun.which(c));
	if (opts.configured) {
		try {
			accessSync(opts.configured, constants.X_OK);
			return { status: "ok", path: opts.configured };
		} catch {
			return { status: "missing" };
		}
	}
	const found = which(DEFAULT_BINARY);
	if (found) return { status: "ok", path: found };
	return { status: "missing" };
}

export const DEFAULT_BINARY = "llama-server";
const HELP_TIMEOUT_MS = 5000;

/**
 * Run `<binary> --help` and capture stdout+stderr. Any failure (exec error,
 * timeout) yields "" — parsing empty text disables every flag safely.
 */
export async function captureHelp(command: string): Promise<string> {
	try {
		const proc = Bun.spawn([command, "--help"], {
			stdout: "pipe",
			stderr: "pipe",
			stdin: "ignore",
		});
		const timer = setTimeout(() => {
			try {
				proc.kill(9);
			} catch {
				// already exited
			}
		}, HELP_TIMEOUT_MS);
		const text = await new Response(proc.stdout).text();
		await proc.exited;
		clearTimeout(timer);
		return text;
	} catch {
		return "";
	}
}
