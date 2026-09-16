import { readFileSync } from "node:fs";

export type ProcessInspectionStatus = "alive" | "dead" | "unknown";

export interface ProcessIdentity {
	pid: number;
	command?: string[];
	owner?: number;
	startIdentity?: string;
}

export interface ProcessInspector {
	inspect(pid: number): ProcessInspectionStatus | ProcessIdentity;
	canSignal?(pid: number): boolean;
}

export class ProcProcessInspector implements ProcessInspector {
	inspect(pid: number): ProcessInspectionStatus | ProcessIdentity {
		try {
			const command = readFileSync(`/proc/${pid}/cmdline`, "utf8")
				.split("\0")
				.filter(Boolean);
			const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
			return { pid, command, startIdentity: statStartIdentity(stat) };
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			return code === "ENOENT" ? "dead" : "unknown";
		}
	}
	canSignal(pid: number): boolean {
		try {
			process.kill(pid, 0);
			return true;
		} catch (error) {
			return (error as NodeJS.ErrnoException).code !== "ESRCH";
		}
	}
}

export function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ESRCH";
	}
}

export class WindowsProcessInspector implements ProcessInspector {
	inspect(pid: number): ProcessInspectionStatus | ProcessIdentity {
		if (!isPidAlive(pid)) return "dead";
		try {
			const res = Bun.spawnSync([
				"tasklist",
				"/FI",
				`PID eq ${pid}`,
				"/FO",
				"CSV",
				"/NH",
			]);
			const out = res.stdout.toString().trim();
			if (!out || out.startsWith("INFO: No tasks")) {
				return "dead";
			}
			const match = out.match(/^"([^"]+)"/);
			if (match?.[1]) {
				return { pid, command: [match[1]] };
			}
			return "unknown";
		} catch {
			return "unknown";
		}
	}
	canSignal(pid: number): boolean {
		return isPidAlive(pid);
	}
}

export class UnsupportedProcessInspector implements ProcessInspector {
	inspect(pid: number): ProcessInspectionStatus {
		if (!isPidAlive(pid)) return "dead";
		return "unknown";
	}
	canSignal(_pid: number): boolean {
		return false;
	}
}

export function defaultProcessInspector(): ProcessInspector {
	if (process.platform === "linux") return new ProcProcessInspector();
	if (process.platform === "win32") return new WindowsProcessInspector();
	return new UnsupportedProcessInspector();
}

export function isLlamaServerCommand(command: string[] | undefined): boolean {
	return (
		command?.some((arg) => {
			const lower = arg.toLowerCase();
			return (
				lower === "llama-server" ||
				lower === "llama-server.exe" ||
				lower.endsWith("/llama-server") ||
				lower.endsWith("\\llama-server") ||
				lower.endsWith("/llama-server.exe") ||
				lower.endsWith("\\llama-server.exe")
			);
		}) ?? false
	);
}

function statStartIdentity(stat: string): string | undefined {
	const end = stat.lastIndexOf(")");
	if (end < 0) return undefined;
	const fields = stat.slice(end + 2).split(" ");
	return fields[19];
}
