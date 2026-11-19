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
	// #69: ~/.config is the standard/preferred base. ~/.configs is only a
	// legacy fallback, used when ~/.config/llama-deck is absent AND a legacy
	// ~/.configs/llama-deck install actually exists. A stray ~/.configs
	// directory alone no longer hijacks new installs.
	const preferredBase = join(home, ".config");
	const legacyBase = join(home, ".configs");
	const defaultLocalConfig =
		!existsSync(join(preferredBase, "llama-deck")) &&
		existsSync(join(legacyBase, "llama-deck"))
			? legacyBase
			: preferredBase;
	const configBase = env.XDG_CONFIG_HOME || defaultLocalConfig;
	const stateDir = join(stateBase, "llama-deck");
	const configDir = join(configBase, "llama-deck");
	return { stateDir, configDir, pidFile: join(stateDir, "server.pid") };
}
