/**
 * Preset portability (#11): single-preset export as a self-contained JSON
 * document and collision-safe import into the preset store. Reuses the
 * PresetFile schema machinery (§5) and the forward-only migration rule (D1):
 * documents written by NEWER builds are rejected, not guessed at.
 * DATA ONLY — no I/O; the caller owns store reads/writes.
 */

import { CURRENT_VERSION, migrate } from "./migrations";
import { isPresetFileShape, type Preset, type PresetFile } from "./presets";

export type ParseResult =
	| { ok: true; doc: PresetFile }
	| { ok: false; error: string };

/**
 * Wrap one preset as a self-contained PresetFile document: the same schema
 * the store uses, with exactly one preset entry.
 */
export function exportPresetDoc(preset: Preset): PresetFile {
	return {
		version: CURRENT_VERSION,
		$schema: "./schema.preset.json",
		presets: [preset],
	};
}

/**
 * Parse shared-preset JSON: must be a valid PresetFile. Legacy v1 documents
 * migrate forward; unknown FUTURE versions are rejected (D1: forward-only).
 */
export function parsePresetDoc(raw: string): ParseResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ok: false, error: "Not valid JSON — expected a preset document" };
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return {
			ok: false,
			error: "Not a preset document (expected a JSON object)",
		};
	}
	const doc = parsed as Record<string, unknown>;
	const version = typeof doc.version === "number" ? doc.version : 1;
	if (version > CURRENT_VERSION) {
		return {
			ok: false,
			error: `Unsupported preset version ${version} (this build supports up to ${CURRENT_VERSION}; forward-only)`,
		};
	}
	const migrated = migrate(doc) as unknown as PresetFile;
	if (!isPresetFileShape(migrated)) {
		return {
			ok: false,
			error: "Not a valid preset document (missing or malformed presets)",
		};
	}
	if (migrated.presets.length === 0) {
		return { ok: false, error: "Preset document contains no presets" };
	}
	return { ok: true, doc: migrated };
}

export interface ImportedPreset {
	preset: Preset;
	/** True when the id was already in use and a -N suffix was applied. */
	renamedId: boolean;
	/** The id the document carried before collision resolution. */
	originalId: string;
}

export interface ImportResult {
	doc: PresetFile;
	imported: ImportedPreset[];
}

/**
 * Merge an imported document's presets into a store document. IDs already in
 * use get a -2, -3, ... suffix; everything else is preserved verbatim so an
 * export -> import round trip is byte-identical. Pure: returns a NEW store
 * doc; callers persist via savePresets.
 */
export function importPresetsInto(
	store: PresetFile,
	incoming: PresetFile,
): ImportResult {
	const existingIds = new Set(store.presets.map((p) => p.id));
	const imported: ImportedPreset[] = incoming.presets.map((preset) => {
		if (!existingIds.has(preset.id)) {
			existingIds.add(preset.id);
			return { preset, renamedId: false, originalId: preset.id };
		}
		let suffix = 2;
		while (existingIds.has(`${preset.id}-${suffix}`)) suffix++;
		const id = `${preset.id}-${suffix}`;
		existingIds.add(id);
		return {
			preset: { ...preset, id },
			renamedId: true,
			originalId: preset.id,
		};
	});
	return {
		doc: {
			...store,
			presets: [...store.presets, ...imported.map((i) => i.preset)],
		},
		imported,
	};
}
