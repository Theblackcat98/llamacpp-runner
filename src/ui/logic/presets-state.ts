/**
 * Presets screen state (§2, §5; P4-FR-18..19): pure list/CRUD logic for the
 * Presets tab — list, clone, delete, set-default, broken-preset detection
 * and re-link. Persistence stays in core (store/presets.ts); this module is
 * UI-side and side-effect free.
 */
import type { Preset, PresetFile } from "../../core/store/presets";
import { splitFlags } from "../../core/store/presets";

export interface PresetRow {
	id: string;
	name: string;
	modelPath: string;
	lastUsed: string | null;
	/** "broken" = model file missing from the current scan (§7). */
	status: "ok" | "broken";
	unknownFlags: string[];
}

export function buildRows(
	presets: Preset[],
	existingModelPaths: Set<string>,
): PresetRow[] {
	return presets.map((p) => ({
		id: p.id,
		name: p.name,
		modelPath: p.model_path,
		lastUsed: p.last_used,
		status: existingModelPaths.has(p.model_path) ? "ok" : "broken",
		unknownFlags: Object.keys(splitFlags(p.flags).unknown),
	}));
}

function withPresets(file: PresetFile, presets: Preset[]): PresetFile {
	return { ...file, presets };
}

/** Clone: copy flags/env verbatim, mint fresh id + timestamps. */
export function clonePreset(file: PresetFile, id: string): PresetFile {
	const source = file.presets.find((p) => p.id === id);
	if (!source) return file;
	const clone: Preset = {
		...source,
		id: `${source.id}-clone-${Date.now().toString(36)}`,
		name: `${source.name} (copy)`,
		created_at: new Date().toISOString(),
		last_used: null,
	};
	return withPresets(file, [...file.presets, clone]);
}

export function deletePreset(file: PresetFile, id: string): PresetFile {
	return withPresets(
		file,
		file.presets.filter((p) => p.id !== id),
	);
}

/** Default preset = the one lastSession restores on boot (§5). */
export function setDefault(
	file: PresetFile,
	id: string,
	tab: number,
): PresetFile {
	return { ...file, lastSession: { preset_id: id, tab } };
}

export function markLastUsed(
	file: PresetFile,
	id: string,
	timestamp: string,
): PresetFile {
	return withPresets(
		file,
		file.presets.map((p) => (p.id === id ? { ...p, last_used: timestamp } : p)),
	);
}

/** Re-link a broken preset to a new model path (P4-FR-18). */
export function relink(preset: Preset, newPath: string): Preset {
	return { ...preset, model_path: newPath };
}

/** Inputs for loading a preset into the Configurator. */
export function loadIntoConfigurator(preset: Preset): {
	modelPath: string;
	values: Record<string, unknown>;
} {
	return { modelPath: preset.model_path, values: { ...preset.flags } };
}
