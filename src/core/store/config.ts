import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWrite } from "./atomic";

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
		) as unknown;
		if (
			typeof raw === "object" &&
			raw !== null &&
			(typeof (raw as Record<string, unknown>).modelsDir === "undefined" ||
				typeof (raw as Record<string, unknown>).modelsDir === "string")
		)
			return raw as AppConfig;
	} catch {
		// first run -> empty config (§7)
	}
	return {};
}

export function saveConfig(configDir: string, config: AppConfig): void {
	mkdirSync(configDir, { recursive: true });
	atomicWrite(configFilePath(configDir), JSON.stringify(config, null, "\t"));
}
