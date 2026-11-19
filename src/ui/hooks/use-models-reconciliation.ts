import {
	type Dispatch,
	type RefObject,
	type SetStateAction,
	useEffect,
	useState,
} from "react";
import type { createBus } from "../../core/bus";
import type { IntentMap, StateMap } from "../../core/bus-contract";
import { entryLaunchBlocker } from "../../core/models/launch-guard";
import type { ModelEntry } from "../../core/models/types";
import {
	type ConfiguratorState,
	clampContext,
	createConfigurator,
} from "../logic/configurator-state";

type Bus = ReturnType<typeof createBus<IntentMap, StateMap>>;

export interface ModelsReconciliation {
	entries: ModelEntry[];
	scanning: boolean;
	scanError: string | undefined;
	modelsDir: string | null;
	selectedIndex: number;
	selectModel: (index: number) => void;
	rescan: () => void;
	setModelsDir: (dir: string) => void;
}

/**
 * Issue #70: model-library state extracted from SessionApp — the
 * MODELS_STATE / MODELS_DIR subscriptions and the reconciliation of scan
 * results into the configurator:
 *
 * - the configured model still exists → refresh its header metadata in
 *   place and clear the stale flag (#60: the file is back);
 * - it vanished → keep the configurator (edits intact), mark the model
 *   stale, and prompt to relink — never silently swap to another
 *   model (#60);
 * - nothing configured yet → auto-select the first healthy entry.
 *
 * Also emits the boot RESCAN (Issue #25): if modelsService.boot()
 * completed before React mounted, this synchronizes state immediately.
 * SessionApp calls useConsoleLog first, so the LOG_LINE subscription
 * already exists when the scan's log lines arrive.
 */
export function useModelsReconciliation(opts: {
	bus: Bus;
	initialModelsDir: string | null;
	configRef: RefObject<ConfiguratorState>;
	setConfig: Dispatch<SetStateAction<ConfiguratorState>>;
}): ModelsReconciliation {
	const { bus, configRef, setConfig } = opts;
	const [entries, setEntries] = useState<ModelEntry[]>([]);
	const [scanning, setScanning] = useState(false);
	const [scanError, setScanError] = useState<string | undefined>(undefined);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [modelsDir, setModelsDirState] = useState<string | null>(
		() => opts.initialModelsDir,
	);

	function selectModelFromEntries(list: ModelEntry[], index: number): void {
		setSelectedIndex(index);
		const entry = list[index];
		// #18: parse errors and incomplete split groups surface as inspector
		// diagnostics only — they never construct a launch-ready Configurator.
		if (!entry || entryLaunchBlocker(entry)) return;
		setConfig(
			clampContext(
				createConfigurator({
					path: entry.path,
					blockCount: entry.blockCount,
					contextLength: entry.contextLength,
					fileSize: entry.totalBytes,
					headCount: entry.headCount,
					headCountKv: entry.headCountKv,
					embeddingLength: entry.embeddingLength,
					keyLength: entry.keyLength,
				}),
			),
		);
	}

	function selectModel(index: number): void {
		selectModelFromEntries(entries, index);
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: subscriptions are bound on mount
	useEffect(() => {
		// Boot-sync: trigger rescan on mount so if modelsService.boot()
		// completed before React mounted, we synchronize state
		// immediately (Issue #25).
		bus.emitIntent("RESCAN", {});
		const offModels = bus.onState("MODELS_STATE", (event) => {
			setEntries(event.entries);
			setScanning(event.scanning);
			setScanError(event.error);
			if (event.dir !== undefined && event.dir !== null) {
				setModelsDirState(event.dir);
			}
			if (event.entries.length > 0) {
				const current = configRef.current;
				if (current.model) {
					const idx = event.entries.findIndex(
						(e) => e.path === current.model?.path,
					);
					if (idx !== -1) {
						setSelectedIndex(idx);
						const matched = event.entries[idx];
						if (matched) {
							setConfig((prev) => {
								if (!prev.model || prev.model.path !== matched.path)
									return prev;
								return {
									...prev,
									model: {
										path: matched.path,
										blockCount: matched.blockCount,
										contextLength: matched.contextLength,
										fileSize: matched.totalBytes,
										headCount: matched.headCount,
										headCountKv: matched.headCountKv,
										embeddingLength: matched.embeddingLength,
										keyLength: matched.keyLength,
										incomplete: matched.incomplete,
										// #60: the file is back in the library.
										stale: false,
									},
								};
							});
						}
					} else {
						// #60: the configured model vanished (deleted file,
						// watcher rescan, transient scan error). Keep the
						// configurator — edits intact — mark it stale, and
						// prompt to relink. The old path silently swapped to
						// the first valid model.
						const prev = configRef.current;
						if (prev.model && !prev.model.stale) {
							setConfig({ ...prev, model: { ...prev.model, stale: true } });
							bus.emitState("LOG_LINE", {
								stream: "err",
								text: "[SYS] configured model missing from library — relink in Explorer or rescan",
							});
						}
					}
				} else {
					const firstValid = event.entries.findIndex(
						(e) => !e.error && !e.incomplete,
					);
					if (firstValid !== -1) {
						selectModelFromEntries(event.entries, firstValid);
					}
				}
			}
		});
		const offDir = bus.onState("MODELS_DIR", (event) => {
			setModelsDirState(event.dir);
		});
		return () => {
			offModels();
			offDir();
		};
	}, []);

	return {
		entries,
		scanning,
		scanError,
		modelsDir,
		selectedIndex,
		selectModel,
		rescan: () => bus.emitIntent("RESCAN", {}),
		setModelsDir: (dir: string) => bus.emitIntent("SET_MODELS_DIR", { dir }),
	};
}
