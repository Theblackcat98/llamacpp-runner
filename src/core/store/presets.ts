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
}
export function loadPresets(filePath: string): LoadResult {
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(filePath, "utf8"));
	} catch {
		return { data: emptyPresetFile(), migratedFrom: undefined };
	}
	if (typeof raw !== "object" || raw === null)
		return { data: emptyPresetFile(), migratedFrom: undefined };
	const doc = raw as Record<string, unknown>;
	const sourceVersion = typeof doc.version === "number" ? doc.version : 1;
	const migrated = migrate(doc) as unknown as PresetFile;
	if (!isPresetFile(migrated))
		return { data: emptyPresetFile(), migratedFrom: undefined };
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
