import { basename } from "node:path";
import { type Dispatch, type SetStateAction, useState } from "react";
import type { createBus } from "../../core/bus";
import type { IntentMap, StateMap } from "../../core/bus-contract";
import type { ModelEntry } from "../../core/models/types";
import {
	loadPresets,
	type PresetFile,
	presetsFilePath,
	renamePresetInFile,
	savePresets,
} from "../../core/store/presets";
import type { AppPaths } from "../../core/store/state-paths";
import { PRESETS_TAB } from "../constants";
import {
	type ConfiguratorState,
	clampContext,
	libraryFromEntries,
	loadPresetInto,
} from "../logic/configurator-state";
import {
	clonePreset,
	deletePreset,
	markLastUsed,
	relink,
	setDefault,
} from "../logic/presets-state";

type Bus = ReturnType<typeof createBus<IntentMap, StateMap>>;

export interface PresetStore {
	presetsFile: PresetFile;
	persistPresets: (next: PresetFile) => void;
	savePreset: (name?: string) => void;
	loadPreset: (preset: {
		id: string;
		model_path: string;
		flags: Record<string, unknown>;
	}) => ConfiguratorState;
	/** Tier 3: rename via the shell-owned modal — store-persisted. */
	rename: (id: string, name: string) => void;
	relinkPreset: (id: string, newPath: string) => void;
	clone: (id: string) => void;
	remove: (id: string) => void;
	setDefaultPreset: (id: string) => void;
	/** #64: stamp last_used for the preset the configurator came from. */
	markLaunchUsed: (sourcePresetId: string) => void;
}

/**
 * Issue #70: preset state extracted from SessionApp. One persistence
 * path — persistPresets updates React state AND disk together, so what
 * the Presets tab renders never diverges from presets.json (#58).
 */
export function usePresetStore(opts: {
	paths: AppPaths;
	bus: Bus;
	initialPresetStore: PresetFile | null;
	config: ConfiguratorState;
	setConfig: Dispatch<SetStateAction<ConfiguratorState>>;
	entries: ModelEntry[];
}): PresetStore {
	const { paths, bus, config, setConfig, entries } = opts;
	const [presetsFile, setPresetsFile] = useState<PresetFile>(
		() => opts.initialPresetStore ?? { version: 2, presets: [] },
	);

	function persistPresets(next: PresetFile): void {
		setPresetsFile(next);
		const store = loadPresets(presetsFilePath(paths.configDir));
		savePresets(presetsFilePath(paths.configDir), next, {
			migratedFrom: store.migratedFrom === 2 ? undefined : store.migratedFrom,
		});
	}

	function savePreset(name?: string): void {
		if (!config.model) return;
		const store = loadPresets(presetsFilePath(paths.configDir));
		const file = store.data;
		if (!file) return;
		const id = `preset-${Date.now()}`;
		// #58: the preset identity derives from the CONFIGURED model — the
		// Explorer cursor is a navigation aid, not the save source.
		const modelName = basename(config.model.path);
		const next: PresetFile = {
			...file,
			presets: [
				...file.presets,
				{
					id,
					// Tier 2 (audit): the Ctrl+S name prompt supplies the
					// name; bare saves keep the timestamped default.
					name:
						name?.trim() ||
						`${modelName} (saved ${new Date().toISOString().slice(11, 19)})`,
					model_path: config.model.path,
					flags: config.values,
					env_vars: {},
					created_at: new Date().toISOString(),
					last_used: null,
				},
			],
			lastSession: { preset_id: id, tab: 1 },
		};
		// #58: state + disk in ONE path — saving never diverges from what
		// the Presets tab renders (the old path skipped setPresetsFile).
		persistPresets(next);
		bus.emitState("LOG_LINE", {
			stream: "out",
			text: `[SYS] preset saved: ${id}`,
		});
	}

	function loadPreset(preset: {
		id: string;
		model_path: string;
		flags: Record<string, unknown>;
	}): ConfiguratorState {
		const next = clampContext(
			loadPresetInto(
				config,
				preset.flags,
				preset.model_path,
				// #60: resolve metadata from the real library — a model in
				// the scanned dir gets its true header numbers, never the
				// previous model's.
				libraryFromEntries(entries),
			),
		);
		// #64: remember the source so launching stamps its last_used.
		next.sourcePresetId = preset.id;
		// #18: a preset pointing at an incomplete split group carries the
		// validation state into the Configurator — launch stays blocked.
		if (
			next.model &&
			entries.some(
				(e) => e.incomplete && e.paths.includes(next.model?.path ?? ""),
			)
		) {
			next.model = { ...next.model, incomplete: true };
		}
		setConfig(next);
		bus.emitState("LOG_LINE", {
			stream: "out",
			text: "[SYS] preset loaded into configurator",
		});
		return next;
	}

	function rename(id: string, name: string): void {
		const { file, renamed } = renamePresetInFile(
			presetsFile,
			id,
			name.trim(),
		);
		if (!renamed) return;
		persistPresets(file);
		bus.emitState("LOG_LINE", {
			stream: "out",
			text: `[SYS] preset renamed: ${name.trim()}`,
		});
	}

	function relinkPreset(id: string, newPath: string): void {
		const preset = presetsFile.presets.find((p) => p.id === id);
		if (!preset) return;
		persistPresets({
			...presetsFile,
			presets: presetsFile.presets.map((p) =>
				p.id === id ? relink(p, newPath) : p,
			),
		});
		bus.emitState("LOG_LINE", {
			stream: "out",
			text: `[SYS] preset ${id} relinked to ${newPath}`,
		});
	}

	function markLaunchUsed(sourcePresetId: string): void {
		persistPresets(
			markLastUsed(presetsFile, sourcePresetId, new Date().toISOString()),
		);
	}

	return {
		presetsFile,
		persistPresets,
		savePreset,
		loadPreset,
		rename,
		relinkPreset,
		clone: (id) => persistPresets(clonePreset(presetsFile, id)),
		remove: (id) => persistPresets(deletePreset(presetsFile, id)),
		setDefaultPreset: (id) =>
			persistPresets(setDefault(presetsFile, id, PRESETS_TAB)),
		markLaunchUsed,
	};
}
