/**
 * Binary resolution + runtime --help capture (§7, P4-FR-05).
 * "llama-server not on PATH" -> missing status; callers prompt for a path and
 * persist it (config store). Registry validation idles until resolved.
 */
import { accessSync, constants } from "node:fs";
import { type FlagAvailability, registryAvailability } from "./help-parser";

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

export interface CaptureHelpOptions {
	/** Probe timeout in ms (default 5000). */
	timeoutMs?: number;
}

/** Drain a piped stdio stream to text; null streams and read errors yield "". */
async function readStream(stream: unknown): Promise<string> {
	if (!stream) return "";
	try {
		return await new Response(stream as ReadableStream).text();
	} catch {
		return "";
	}
}

/**
 * Run `<binary> --help` and capture stdout+stderr (Issue #19).
 *
 * Both streams are drained concurrently so a chatty stderr cannot deadlock
 * the probe on a full pipe buffer. Any failure (exec error, timeout) yields
 * "" — callers MUST treat "" as unverified, never as validated.
 *
 * Short-lived-probe teardown (documented equivalent of the §6.2 shared
 * lifecycle for non-interactive probes): on timeout the child is sent
 * SIGKILL and reaped via `exited` before returning, so no orphan can remain.
 * No graceful SIGINT wait — `--help` output is non-interactive and the probe
 * must be bounded.
 */
export async function captureHelp(
	command: string,
	opts: CaptureHelpOptions = {},
): Promise<string> {
	const timeoutMs = opts.timeoutMs ?? HELP_TIMEOUT_MS;
	try {
		let spawnArgs = [command, "--help"];
		if (process.platform === "win32" && command.endsWith(".sh")) {
			const { resolveBash } = await import("../process/transport");
			spawnArgs = [resolveBash(), command, "--help"];
		}
		const proc = Bun.spawn(spawnArgs, {
			stdout: "pipe",
			stderr: "pipe",
			stdin: "ignore",
		});
		// Start draining both streams BEFORE awaiting exit (deadlock-safe).
		const outP = readStream(proc.stdout);
		const errP = readStream(proc.stderr);
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			try {
				proc.kill("SIGKILL");
			} catch {
				// already exited
			}
		}, timeoutMs);
		await proc.exited;
		clearTimeout(timer);
		if (timedOut) return "";
		const [out, err] = await Promise.all([outP, errP]);
		if (!err) return out;
		if (!out) return err;
		return out + (out.endsWith("\n") ? "" : "\n") + err;
	} catch {
		return "";
	}
}

export interface ProbeOptions extends ResolveBinaryOptions {
	/** Probe timeout in ms (default 5000). */
	timeoutMs?: number;
}

export interface ProbeResult {
	/** Resolved binary path, or null when resolution failed. */
	resolvedPath: string | null;
	/** Raw combined --help text ("" when unverified). */
	helpText: string;
	/**
	 * Registry availability map. Empty when unverified — callers keep
	 * current launch behavior on {} but MUST NOT present the binary as
	 * capability-validated unless `verified` is true.
	 */
	availability: Record<string, FlagAvailability>;
	/** True only when the resolved binary's --help was actually captured. */
	verified: boolean;
}

/**
 * Central short-lived binary probe (Issue #19): resolve the configured or
 * PATH binary, capture its `--help` AT THE RESOLVED PATH, and map registry
 * availability. Safe behavior on any failure: `verified: false` with an
 * empty availability map — never a false-validated result.
 */
export async function probeBinaryAvailability(
	opts: ProbeOptions = {},
): Promise<ProbeResult> {
	const status = resolveBinaryPath(opts);
	if (status.status === "missing") {
		return {
			resolvedPath: null,
			helpText: "",
			availability: {},
			verified: false,
		};
	}
	const helpText = await captureHelp(status.path, {
		timeoutMs: opts.timeoutMs,
	});
	if (!helpText) {
		return {
			resolvedPath: status.path,
			helpText: "",
			availability: {},
			verified: false,
		};
	}
	return {
		resolvedPath: status.path,
		helpText,
		availability: registryAvailability(helpText),
		verified: true,
	};
}
