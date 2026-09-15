import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";

let cachedBash: string | null | undefined;
export function resolveBash(): string {
	if (cachedBash !== undefined) return cachedBash ?? "bash";
	if (process.platform === "win32") {
		const git = Bun.which("git");
		if (git) {
			const candidate = resolve(dirname(git), "../bin/bash.exe");
			if (existsSync(candidate)) {
				cachedBash = candidate;
				return candidate;
			}
		}
		const standard = "C:\\Program Files\\Git\\bin\\bash.exe";
		if (existsSync(standard)) {
			cachedBash = standard;
			return standard;
		}
	}
	cachedBash = null;
	return "bash";
}

export interface ExitInfo {
	code: number;
	signal: string | null;
}

export type KillSignal = "SIGINT" | "SIGKILL";

export interface Transport {
	readonly pid: number;
	onData(cb: (chunk: string) => void): void;
	onExit(cb: (info: ExitInfo) => void): void;
	kill(signal: KillSignal): boolean;
}

export interface SpawnOptions {
	command: string;
	args: string[];
	cwd?: string;
	env?: Record<string, string>;
}

function decodeStream(
	stream: NodeJS.ReadableStream | null,
	cb: (chunk: string) => void,
): void {
	if (!stream) return;
	const decoder = new StringDecoder("utf8");
	stream.on("data", (raw: Buffer) => {
		cb(decoder.write(raw));
	});
}

export class PipeTransport implements Transport {
	readonly pid: number;

	constructor(opts: SpawnOptions) {
		let command = opts.command;
		let args = opts.args;
		if (process.platform === "win32") {
			if (command === "bash") {
				command = resolveBash();
			} else if (command.endsWith(".sh")) {
				args = [command, ...args];
				command = resolveBash();
			}
		}
		const child = spawn(command, args, {
			cwd: opts.cwd,
			env: opts.env ? { ...process.env, ...opts.env } : process.env,
			stdio: ["ignore", "pipe", "pipe"],
			detached: false,
		});
		this.child = child;
		this.pid = child.pid ?? -1;
	}

	private child: ReturnType<typeof spawn>;

	onData(cb: (chunk: string) => void): void {
		decodeStream(this.child.stdout, cb);
		decodeStream(this.child.stderr, cb);
	}

	onExit(cb: (info: ExitInfo) => void): void {
		this.child.once("close", (code, signal) => {
			cb({ code: code ?? -1, signal: signal ?? null });
		});
	}

	kill(signal: KillSignal): boolean {
		return this.child.kill(signal);
	}
}
