import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface AppConfig {
	modelsDir?: string;
}

export function configFilePath(configDir: string): string {
	return join(configDir, "config.json");
}

export function loadConfig(configDir: string): AppConfig {
	try {
		const raw = JSON.parse(
			readFileSync(configFilePath(configDir), "utf8"),
		) as AppConfig;
		if (typeof raw === "object" && raw !== null) return raw;
	} catch {
		// first run -> empty config (§7)
	}
	return {};
}

/** Atomic write: temp file + rename (D1). */
export function saveConfig(configDir: string, config: AppConfig): void {
	mkdirSync(configDir, { recursive: true });
	const tmpPath = `${configFilePath(configDir)}.tmp`;
	writeFileSync(tmpPath, JSON.stringify(config, null, "\t"));
	renameSync(tmpPath, configFilePath(configDir));
}
