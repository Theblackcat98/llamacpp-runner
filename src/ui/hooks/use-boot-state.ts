import { useCallback, useEffect, useState } from "react";
import type { createBus } from "../../core/bus";
import type { IntentMap, StateMap } from "../../core/bus-contract";
import {
	getOrDetectHardware,
	type HardwareInfo,
} from "../../core/hardware/detect";
import { consolidateLegacyConfig, loadConfig } from "../../core/store/config";
import {
	loadPresets,
	type Preset,
	type PresetFile,
	presetsFilePath,
} from "../../core/store/presets";
import type { AppPaths } from "../../core/store/state-paths";

/**
 * Issue #70: the one-shot boot load extracted from SessionApp. The config
 * file and the presets store are read exactly once (lazy initializer) —
 * the FIRST presets load matters: its corrupt-file backup rename wins
 * over every later load, so the backup path is captured here and
 * announced by useConsoleLog once the LOG_LINE subscription exists (#59).
 */
export interface BootState {
	configFile: ReturnType<typeof loadConfig>;
	presetStore: PresetFile | null;
	last: PresetFile["lastSession"];
	preset: Preset | undefined;
	corruptBackup: string | undefined;
}

export function useBootState(paths: AppPaths): BootState {
	const [initialState] = useState<BootState>(() => {
		// #69 (core consolidation, minimal call-site): migrate legacy
		// presets.json binary_path/theme into config.json before reading
		// either store, so config.json is the boot source for both.
		try {
			consolidateLegacyConfig(paths.configDir);
		} catch {}
		const configFile = loadConfig(paths.configDir);
		const presetStore = loadPresets(presetsFilePath(paths.configDir));
		const last = presetStore.data?.lastSession;
		const preset = last
			? presetStore.data?.presets.find((item) => item.id === last.preset_id)
			: undefined;
		return {
			configFile,
			presetStore: presetStore.data,
			last,
			preset,
			corruptBackup: presetStore.corruptBackup,
		};
	});
	return initialState;
}

type Bus = ReturnType<typeof createBus<IntentMap, StateMap>>;

/** Hardware probe: persisted value first, live detection fills in async. */
export function useHardware(
	paths: AppPaths,
	initial: HardwareInfo | null,
	bus: Bus,
): { hardware: HardwareInfo | null; reprobeHardware: () => void } {
	const [hardware, setHardware] = useState<HardwareInfo | null>(() => initial);
	useEffect(() => {
		void getOrDetectHardware(paths.configDir)
			.then(setHardware)
			.catch(() => {});
	}, [paths.configDir]);
	// #66: palette "Re-probe hardware" — bypass the cached probe and
	// refresh the verdict/auto-fit readouts with a fresh detection.
	const reprobeHardware = useCallback(() => {
		void getOrDetectHardware(paths.configDir, { reprobe: true })
			.then((hw) => {
				setHardware(hw);
				bus.emitState("LOG_LINE", {
					stream: "out",
					text: `[SYS] hardware reprobed: ${hw.source}`,
				});
			})
			.catch((err) => {
				bus.emitState("LOG_LINE", {
					stream: "out",
					text: `[SYS] hardware probe failed: ${err.message}`,
				});
			});
	}, [bus, paths.configDir]);
	return { hardware, reprobeHardware };
}
