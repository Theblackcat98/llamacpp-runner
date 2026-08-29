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

export class UnsupportedProcessInspector implements ProcessInspector {
	inspect(_pid: number): ProcessInspectionStatus {
		return "unknown";
	}
	canSignal(_pid: number): boolean {
		return false;
	}
}

export function defaultProcessInspector(): ProcessInspector {
	return process.platform === "linux"
		? new ProcProcessInspector()
		: new UnsupportedProcessInspector();
}

export function isLlamaServerCommand(command: string[] | undefined): boolean {
	return (
		command?.some(
			(arg) => arg === "llama-server" || arg.endsWith("/llama-server"),
		) ?? false
	);
}

function statStartIdentity(stat: string): string | undefined {
	const end = stat.lastIndexOf(")");
	if (end < 0) return undefined;
	const fields = stat.slice(end + 2).split(" ");
	return fields[19];
}
