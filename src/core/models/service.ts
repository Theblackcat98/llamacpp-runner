import type { createBus } from "../bus";
import type { IntentMap, StateMap } from "../bus-contract";
import { loadConfig, saveConfig } from "../store/config";
import type { AppPaths } from "../store/state-paths";
import { scanModels } from "./scanner";
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
export function createModelsService(bus: Bus, paths: AppPaths): ModelsService {
	let watcher: { close(): void } | null = null;
	let scanning = false;
	let disposed = false;
	let currentDir: string | null = null;

	async function scan(dir: string): Promise<void> {
		if (scanning || disposed) return;
		scanning = true;
		bus.emitState("MODELS_STATE", { entries: [], scanning: true });
		try {
			const result = await scanModels([dir], { stateDir: paths.stateDir });
			if (disposed) return;
			bus.emitState("MODELS_STATE", {
				entries: result.entries,
				scanning: false,
			});
		} catch (err) {
			if (disposed) return;
			bus.emitState("MODELS_STATE", {
				entries: [],
				scanning: false,
				error: err instanceof Error ? err.message : String(err),
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
			currentDir = loadConfig(paths.configDir).modelsDir ?? null;
			bus.emitState("MODELS_DIR", { dir: currentDir });
			if (currentDir) {
				void scan(currentDir);
				watch(currentDir);
			}
			bus.onIntent("SET_MODELS_DIR", ({ dir }) => {
				saveConfig(paths.configDir, { modelsDir: dir });
				currentDir = dir;
				bus.emitState("MODELS_DIR", { dir: currentDir });
				watch(dir);
				void scan(dir);
			});
			bus.onIntent("RESCAN", () => {
				if (!currentDir) return;
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
