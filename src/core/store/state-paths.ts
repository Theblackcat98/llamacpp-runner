import { existsSync } from "node:fs";
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
	const defaultLocalConfig = existsSync(join(home, ".configs"))
		? join(home, ".configs")
		: join(home, ".config");
	const configBase = env.XDG_CONFIG_HOME || defaultLocalConfig;
	const stateDir = join(stateBase, "llama-deck");
	const configDir = join(configBase, "llama-deck");
	return { stateDir, configDir, pidFile: join(stateDir, "server.pid") };
}
