import { existsSync } from "node:fs";
import type { createBus } from "../bus";
import type { IntentMap, StateMap } from "../bus-contract";
import { loadConfig, saveConfig } from "../store/config";
import { loadPresets, presetsFilePath } from "../store/presets";
import type { AppPaths } from "../store/state-paths";
import { scanModels } from "./scanner";
import type { ModelEntry } from "./types";
import { createModelWatcher } from "./watcher";

export interface ModelsService {
	/** Emits initial MODELS_DIR and starts the first scan if a dir is set. */
	boot(): void;
	dispose(): void;
}

type Bus = ReturnType<typeof createBus<IntentMap, StateMap>>;

/**
 * Headless owner of model discovery: scans on boot/dir change/rescan intent,
 * emits MODELS_STATE/MODELS_DIR, and keeps an incremental watcher running
 * (P3-FR-11, P3-FR-17..19). All traffic flows over the typed bus (D5).
 */
export interface ModelsServiceOptions {
	defaultDir?: string;
}

export function createModelsService(
	bus: Bus,
	paths: AppPaths,
	options?: ModelsServiceOptions,
): ModelsService {
	let watcher: { close(): void } | null = null;
	let scanning = false;
	let disposed = false;
	let currentDir: string | null = null;
	let lastEntries: ModelEntry[] = [];
	let lastError: string | undefined;

	async function scan(dir: string): Promise<void> {
		if (disposed) return;
		if (scanning) {
			bus.emitState("MODELS_STATE", {
				dir: currentDir,
				entries: lastEntries,
				scanning: true,
				error: lastError,
			});
			return;
		}
		scanning = true;
		bus.emitState("MODELS_STATE", {
			dir: currentDir,
			entries: lastEntries,
			scanning: true,
		});
		try {
			const result = await scanModels([dir], { stateDir: paths.stateDir });
			if (disposed) return;
			lastEntries = result.entries;
			lastError = undefined;
			bus.emitState("MODELS_STATE", {
				dir: currentDir,
				entries: result.entries,
				scanning: false,
			});
		} catch (err) {
			if (disposed) return;
			lastError = err instanceof Error ? err.message : String(err);
			bus.emitState("MODELS_STATE", {
				dir: currentDir,
				entries: [],
				scanning: false,
				error: lastError,
			});
		} finally {
			scanning = false;
		}
	}

	function watch(dir: string): void {
		watcher?.close();
		watcher = createModelWatcher([dir], () => {
			if (!scanning && !disposed) void scan(dir);
		});
	}

	return {
		boot(): void {
			const config = loadConfig(paths.configDir);
			currentDir = config.modelsDir ?? null;
			if (!currentDir) {
				// F10: seed first run from the presets default_model_dir (§7).
				// Persisted into config.json so scanner ownership stays there.
				const seeded = loadPresets(presetsFilePath(paths.configDir)).data
					?.default_model_dir;
				if (typeof seeded === "string" && existsSync(seeded)) {
					currentDir = seeded;
					saveConfig(paths.configDir, { ...config, modelsDir: seeded });
				} else if (options?.defaultDir) {
					currentDir = options.defaultDir;
				}
			}
			bus.emitState("MODELS_DIR", { dir: currentDir });
			if (currentDir) {
				void scan(currentDir);
				watch(currentDir);
			}
			bus.onIntent("SET_MODELS_DIR", ({ dir }) => {
				saveConfig(paths.configDir, {
					...loadConfig(paths.configDir),
					modelsDir: dir,
				});
				currentDir = dir;
				bus.emitState("MODELS_DIR", { dir: currentDir });
				watch(dir);
				void scan(dir);
			});
			bus.onIntent("RESCAN", () => {
				if (!currentDir) return;
				bus.emitState("MODELS_DIR", { dir: currentDir });
				void scan(currentDir);
			});
		},
		dispose(): void {
			disposed = true;
			watcher?.close();
			watcher = null;
		},
	};
}
