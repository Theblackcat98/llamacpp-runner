import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWrite } from "./atomic";

export interface AppConfig {
	modelsDir?: string;
	/** Persisted theme name (P5-FR-17); restored on boot (Phase 13). */
	theme?: string;
}

export function configFilePath(configDir: string): string {
	return join(configDir, "config.json");
}

export function loadConfig(configDir: string): AppConfig {
	try {
		const raw = JSON.parse(
			readFileSync(configFilePath(configDir), "utf8"),
		) as unknown;
		if (typeof raw === "object" && raw !== null) {
			const r = raw as Record<string, unknown>;
			const modelsDirOk =
				r.modelsDir === undefined || typeof r.modelsDir === "string";
			const themeOk = r.theme === undefined || typeof r.theme === "string";
			if (modelsDirOk && themeOk) return raw as AppConfig;
		}
	} catch {
		// first run -> empty config (§7)
	}
	return {};
}

export function saveConfig(configDir: string, config: AppConfig): void {
	mkdirSync(configDir, { recursive: true });
	atomicWrite(configFilePath(configDir), JSON.stringify(config, null, "\t"));
}
