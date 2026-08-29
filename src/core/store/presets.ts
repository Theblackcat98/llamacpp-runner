/**
 * Preset store (§5, P4-FR-13..15): JSON at
 * $XDG_CONFIG_HOME/llama-deck/presets.json, schema v2, atomic writes
 * (temp + rename in same dir), forward-only migrations with .bak backup.
 * Unknown flags are preserved verbatim — round-trip safe (D1).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { REGISTRY } from "../flags/registry";
import { migrate } from "./migrations";

export interface Preset {
	id: string;
	name: string;
	model_path: string;
	/** Registry-keyed values; unknown keys are kept verbatim (P4-FR-15). */
	flags: Record<string, unknown>;
	env_vars: Record<string, string>;
	created_at: string;
	last_used: string | null;
}

export interface LastSession {
	preset_id: string;
	tab: number;
}

export interface PresetFile {
	version: number;
	$schema?: string;
	default_model_dir?: string;
	theme?: string;
	binary_path?: string;
	lastSession?: LastSession;
	presets: Preset[];
}

export function presetsFilePath(configDir: string): string {
	return join(configDir, "presets.json");
}

export function emptyPresetFile(): PresetFile {
	return { version: 2, $schema: "./schema.preset.json", presets: [] };
}

export interface SaveOptions {
	/** Previous schema version; when set a .bak of the old file is written. */
	migratedFrom?: number;
	renameFn?: (from: string, to: string) => void;
	writeFn?: (path: string, data: string) => void;
}

/** Atomic write: temp file + rename in the same directory (P4-NFR-02). */
export function savePresets(
	filePath: string,
	doc: PresetFile,
	opts: SaveOptions = {},
): void {
	const dir = dirname(filePath);
	mkdirSync(dir, { recursive: true });
	const tmpPath = `${filePath}.tmp`;
	const write = opts.writeFn ?? ((p, d) => writeFileSync(p, d));
	const rename = opts.renameFn ?? renameSync;

	if (opts.migratedFrom !== undefined) {
		try {
			rename(filePath, `${filePath}.bak`);
		} catch {
			// original may not exist yet; .bak is best-effort
		}
	}

	write(
		tmpPath,
		JSON.stringify({ $schema: "./schema.preset.json", ...doc }, null, "\t"),
	);
	rename(tmpPath, filePath);
}

export interface LoadResult {
	data: PresetFile | null;
	migratedFrom: number | undefined;
}

/**
 * Load presets.json; missing/corrupt file yields an empty v2 doc.
 * Applies forward migrations and reports the origin version so callers can
 * persist the migrated result with a .bak (P4-FR-14).
 */
export function loadPresets(filePath: string): LoadResult {
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(filePath, "utf8"));
	} catch {
		return { data: emptyPresetFile(), migratedFrom: undefined };
	}
	if (typeof raw !== "object" || raw === null) {
		return { data: emptyPresetFile(), migratedFrom: undefined };
	}
	const doc = raw as Record<string, unknown>;
	const hadVersion = typeof doc.version === "number";
	const migrated = migrate(doc) as unknown as PresetFile;
	if (!isPresetFile(migrated)) {
		return { data: emptyPresetFile(), migratedFrom: undefined };
	}
	return {
		data: migrated,
		migratedFrom: hadVersion ? (doc.version as number) : 1,
	};
}

function isPresetFile(value: unknown): value is PresetFile {
	if (typeof value !== "object" || value === null) return false;
	const doc = value as Record<string, unknown>;
	if (doc.version !== 2 || !Array.isArray(doc.presets)) return false;
	return doc.presets.every((item) => {
		if (typeof item !== "object" || item === null) return false;
		const preset = item as Record<string, unknown>;
		return (
			typeof preset.id === "string" &&
			typeof preset.name === "string" &&
			typeof preset.model_path === "string" &&
			typeof preset.flags === "object" &&
			preset.flags !== null &&
			typeof preset.env_vars === "object" &&
			preset.env_vars !== null &&
			typeof preset.created_at === "string" &&
			(preset.last_used === null || typeof preset.last_used === "string")
		);
	});
}

/** Split stored flags into registry-known values and unknown leftovers. */
export function splitFlags(flags: Record<string, unknown>): {
	known: Record<string, unknown>;
	unknown: Record<string, unknown>;
} {
	const known: Record<string, unknown> = {};
	const unknown: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(flags)) {
		if (key in REGISTRY) known[key] = value;
		else unknown[key] = value;
	}
	return { known, unknown };
}
