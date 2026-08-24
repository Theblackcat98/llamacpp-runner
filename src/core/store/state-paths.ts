import { homedir } from "node:os";
import { join } from "node:path";

export interface AppPaths {
	stateDir: string;
	configDir: string;
	pidFile: string;
}

export function resolvePaths(
	env: Record<string, string | undefined> = process.env,
	home: string = homedir(),
): AppPaths {
	const stateBase = env.XDG_STATE_HOME || join(home, ".local", "state");
	const configBase = env.XDG_CONFIG_HOME || join(home, ".config");
	const stateDir = join(stateBase, "llama-deck");
	const configDir = join(configBase, "llama-deck");
	return { stateDir, configDir, pidFile: join(stateDir, "server.pid") };
}
