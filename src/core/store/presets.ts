import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { REGISTRY } from "../flags/registry";
import { atomicWrite } from "./atomic";
import { migrate } from "./migrations";

export interface Preset {
	id: string;
	name: string;
	model_path: string;
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
	/** First-run seed for the models dir only (§5); owner is config.json (#69). */
	default_model_dir?: string;
	/** @deprecated Legacy fallback — owner is config.json `theme` (#69). Migrated by `consolidateLegacyConfig`. */
	theme?: string;
	/** @deprecated Legacy file-level fallback — owner is config.json `binaryPath` (#69). Per-preset `binary_path` on a Preset entry is a separate launch override and is NOT this field. Migrated by `consolidateLegacyConfig`. */
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
	migratedFrom?: number;
	renameFn?: (from: string, to: string) => void;
	writeFn?: (path: string, data: string) => void;
}

export function savePresets(
	filePath: string,
	doc: PresetFile,
	opts: SaveOptions = {},
): void {
	mkdirSync(dirname(filePath), { recursive: true });
	if (opts.migratedFrom !== undefined && existsSync(filePath)) {
		let backup = `${filePath}.bak`;
		let index = 1;
		while (existsSync(backup)) backup = `${filePath}.bak.${index++}`;
		(opts.renameFn ?? renameSync)(filePath, backup);
	}
	atomicWrite(
		filePath,
		JSON.stringify({ $schema: "./schema.preset.json", ...doc }, null, "\t"),
		{
			writeFile: opts.writeFn,
			rename: opts.renameFn,
		},
	);
}

export interface LoadResult {
	data: PresetFile | null;
	migratedFrom: number | undefined;
	/** #59: set when the on-disk file was unreadable/invalid. The original
	 *  was preserved at this path before any write could clobber it. */
	corruptBackup?: string;
}
export interface LoadOptions {
	/** Injectable for tests; defaults to renameSync. */
	renameFn?: (from: string, to: string) => void;
	/** Injectable clock for deterministic backup names in tests. */
	now?: () => number;
}

function isEnoent(error: unknown): boolean {
	return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

/** #59: preserve a corrupt file as `presets.json.corrupt-<timestamp>` so a
 *  truncated write or stray comma never becomes quiet total preset loss. */
function backupCorruptFile(filePath: string, opts: LoadOptions): string {
	const backup = `${filePath}.corrupt-${opts.now ? opts.now() : Date.now()}`;
	(opts.renameFn ?? renameSync)(filePath, backup);
	return backup;
}

export function loadPresets(
	filePath: string,
	opts: LoadOptions = {},
): LoadResult {
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(filePath, "utf8"));
	} catch (error) {
		// A missing file is a fresh install, not corruption (#59).
		if (isEnoent(error)) {
			return { data: emptyPresetFile(), migratedFrom: undefined };
		}
		return {
			data: emptyPresetFile(),
			migratedFrom: undefined,
			corruptBackup: backupCorruptFile(filePath, opts),
		};
	}
	// Arrays parse as objects but are never valid preset documents — the
	// migration would silently normalize them into an empty store (#59).
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return {
			data: emptyPresetFile(),
			migratedFrom: undefined,
			corruptBackup: backupCorruptFile(filePath, opts),
		};
	}
	const doc = raw as Record<string, unknown>;
	const sourceVersion = typeof doc.version === "number" ? doc.version : 1;
	const migrated = migrate(doc) as unknown as PresetFile;
	if (!isPresetFile(migrated)) {
		return {
			data: emptyPresetFile(),
			migratedFrom: undefined,
			corruptBackup: backupCorruptFile(filePath, opts),
		};
	}
	return {
		data: migrated,
		migratedFrom: sourceVersion === 2 ? undefined : sourceVersion,
	};
}
function isPresetFile(value: unknown): value is PresetFile {
	if (typeof value !== "object" || value === null) return false;
	const doc = value as Record<string, unknown>;
	if (doc.version !== 2 || !Array.isArray(doc.presets)) return false;
	return doc.presets.every((item) => {
		if (typeof item !== "object" || item === null) return false;
		const p = item as Record<string, unknown>;
		return (
			typeof p.id === "string" &&
			typeof p.name === "string" &&
			typeof p.model_path === "string" &&
			typeof p.flags === "object" &&
			p.flags !== null &&
			typeof p.env_vars === "object" &&
			p.env_vars !== null &&
			typeof p.created_at === "string" &&
			(p.last_used === null || typeof p.last_used === "string")
		);
	});
}
/** Structural validation of a full PresetFile document (#11 portability). */
export const isPresetFileShape = isPresetFile;

// ---------------------------------------------------------------------------
// Preset management helpers for the CLI (#69 parity with the TUI Presets
// tab): pure PresetFile transforms; callers persist via savePresets.
// ---------------------------------------------------------------------------

/** Find a preset by id or exact name (the CLI's lookup rule). */
export function findPresetInFile(
	file: PresetFile,
	idOrName: string,
): Preset | undefined {
	return file.presets.find((p) => p.id === idOrName || p.name === idOrName);
}

/** Delete a preset; clears lastSession when it pointed at the deleted one. */
export function deletePresetFromFile(
	file: PresetFile,
	idOrName: string,
): { file: PresetFile; removed?: Preset } {
	const target = findPresetInFile(file, idOrName);
	if (!target) return { file };
	const next: PresetFile = {
		...file,
		presets: file.presets.filter((p) => p.id !== target.id),
	};
	if (next.lastSession?.preset_id === target.id) {
		delete next.lastSession;
	}
	return { file: next, removed: target };
}

/** Rename a preset's display name (its id is stable). */
export function renamePresetInFile(
	file: PresetFile,
	idOrName: string,
	newName: string,
): { file: PresetFile; renamed?: Preset } {
	const target = findPresetInFile(file, idOrName);
	if (!target) return { file };
	const renamed: Preset = { ...target, name: newName };
	return {
		file: {
			...file,
			presets: file.presets.map((p) => (p.id === target.id ? renamed : p)),
		},
		renamed,
	};
}

/** Set the default preset: the one lastSession restores on boot (§5). */
export function setDefaultPresetInFile(
	file: PresetFile,
	idOrName: string,
	tab = 3,
): { file: PresetFile; preset?: Preset } {
	const target = findPresetInFile(file, idOrName);
	if (!target) return { file };
	return {
		file: { ...file, lastSession: { preset_id: target.id, tab } },
		preset: target,
	};
}
export function splitFlags(flags: Record<string, unknown>): {
	known: Record<string, unknown>;
	unknown: Record<string, unknown>;
} {
	const known: Record<string, unknown> = {};
	const unknown: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(flags))
		(key in REGISTRY ? known : unknown)[key] = value;
	return { known, unknown };
}
