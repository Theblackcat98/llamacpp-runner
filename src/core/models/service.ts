import { existsSync } from "node:fs";
import type { createBus } from "../bus";
import type { IntentMap, StateMap } from "../bus-contract";
import { expandPath, loadConfig, saveConfig } from "../store/config";
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
	/** #17: a change arrived while a scan was in flight — rescan after. */
	let pendingRescan = false;
	let disposed = false;
	let currentDir: string | null = null;
	let lastEntries: ModelEntry[] = [];
	let lastError: string | undefined;

	async function scan(dir: string): Promise<void> {
		if (disposed) return;
		if (scanning) {
			// #17: never drop invalidation — coalesce into exactly one
			// follow-up scan after the in-flight scan finishes.
			pendingRescan = true;
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
			const scanError =
				result.errors && result.errors.length > 0
					? result.errors.join("; ")
					: undefined;
			lastEntries = result.entries;
			lastError = scanError;
			bus.emitState("MODELS_STATE", {
				dir: currentDir,
				entries: result.entries,
				scanning: false,
				error: scanError,
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
			if (pendingRescan && !disposed) {
				pendingRescan = false;
				void scan(dir);
			}
		}
	}

	function watch(dir: string): void {
		watcher?.close();
		// #17: every watcher event requests a scan; the service coalesces
		// bursts (debounce) and mid-scan arrivals (pending flag) instead of
		// dropping them.
		watcher = createModelWatcher([dir], () => {
			if (!disposed) void scan(dir);
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
				if (typeof seeded === "string") {
					const expandedSeeded = expandPath(seeded);
					if (existsSync(expandedSeeded)) {
						currentDir = expandedSeeded;
						saveConfig(paths.configDir, {
							...config,
							modelsDir: expandedSeeded,
						});
					} else if (options?.defaultDir) {
						currentDir = options.defaultDir;
					}
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
				const resolvedDir = expandPath(dir);
				saveConfig(paths.configDir, {
					...loadConfig(paths.configDir),
					modelsDir: resolvedDir,
				});
				currentDir = resolvedDir;
				bus.emitState("MODELS_DIR", { dir: currentDir });
				watch(resolvedDir);
				void scan(resolvedDir);
			});
			bus.onIntent("RESCAN", () => {
				if (!currentDir) return;
				bus.emitState("MODELS_DIR", { dir: currentDir });
				void scan(currentDir);
			});
		},
		dispose(): void {
			disposed = true;
			pendingRescan = false;
			watcher?.close();
			watcher = null;
		},
	};
}
