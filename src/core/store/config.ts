import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { atomicWrite } from "./atomic";
import { loadPresets, presetsFilePath, savePresets } from "./presets";

/**
 * App settings ownership (#69, §5): config.json is the declared owner of
 * app settings — binary path, theme, models dir, and the cached hardware
 * probe. presets.json owns presets + lastSession only; its file-level
 * `binary_path` / `theme` fields are legacy inputs that
 * `consolidateLegacyConfig` migrates forward exactly once (with the §5
 * `presets.json.bak` backup) and `loadEffectiveConfig` still honours as a
 * fallback until that migration runs. `default_model_dir` in presets.json
 * remains a first-run seed for the models dir (see models/service).
 */
export interface AppConfig {
	modelsDir?: string;
	binaryPath?: string;
	/** Persisted theme name (P5-FR-17); restored on boot (Phase 13). */
	theme?: string;
	/** Cached hardware probe result (Issue #7). */
	hardware?: import("../hardware/detect").HardwareInfo;
}

/**
 * Expands leading `~` or `~/` / `~\` in paths to user's home directory.
 * Preserves paths that do not start with `~` or `~/` / `~\`.
 */
export function expandPath(inputPath: string): string {
	if (inputPath === "~") return homedir();
	if (inputPath.startsWith("~/") || inputPath.startsWith("~\\")) {
		return join(homedir(), inputPath.slice(2));
	}
	return inputPath;
}

export function configFilePath(configDir: string): string {
	return join(configDir, "config.json");
}

export function loadConfig(configDir: string): AppConfig {
	try {
		const raw = JSON.parse(
			readFileSync(configFilePath(configDir), "utf8"),
		) as unknown;
		if (typeof raw === "object" && raw !== null) {
			const r = raw as Record<string, unknown>;
			const modelsDirOk =
				r.modelsDir === undefined || typeof r.modelsDir === "string";
			const themeOk = r.theme === undefined || typeof r.theme === "string";
			const binaryPathOk =
				r.binaryPath === undefined || typeof r.binaryPath === "string";
			const hardwareOk =
				r.hardware === undefined ||
				(typeof r.hardware === "object" && r.hardware !== null);
			if (modelsDirOk && themeOk && binaryPathOk && hardwareOk) {
				const cfg = raw as AppConfig;
				if (cfg.modelsDir) {
					cfg.modelsDir = expandPath(cfg.modelsDir);
				}
				if (cfg.binaryPath) {
					cfg.binaryPath = expandPath(cfg.binaryPath);
				}
				return cfg;
			}
		}
	} catch {
		// first run -> empty config (§7)
	}
	return {};
}

export function saveConfig(configDir: string, config: AppConfig): void {
	mkdirSync(configDir, { recursive: true });
	const toSave: AppConfig = { ...config };
	if (toSave.modelsDir) {
		toSave.modelsDir = expandPath(toSave.modelsDir);
	}
	if (toSave.binaryPath) {
		toSave.binaryPath = expandPath(toSave.binaryPath);
	}
	atomicWrite(configFilePath(configDir), JSON.stringify(toSave, null, "\t"));
}

// ---------------------------------------------------------------------------
// #69: effective config (owner + legacy fallback) and one-time migration
// ---------------------------------------------------------------------------

export type ConfigSource = "config.json" | "presets.json (legacy)" | "unset";

export type ConfigKey = "binary-path" | "models-dir" | "theme";

export const CONFIG_KEYS: readonly ConfigKey[] = [
	"binary-path",
	"models-dir",
	"theme",
] as const;

/** Accept the CLI spellings and the on-disk field spellings for a key. */
export function normalizeConfigKey(raw: string): ConfigKey | null {
	switch (raw) {
		case "binary-path":
		case "binary_path":
		case "binaryPath":
			return "binary-path";
		case "models-dir":
		case "models_dir":
		case "modelsDir":
		case "default_model_dir":
			return "models-dir";
		case "theme":
			return "theme";
		default:
			return null;
	}
}

export function configKeyField(key: ConfigKey): keyof AppConfig {
	switch (key) {
		case "binary-path":
			return "binaryPath";
		case "models-dir":
			return "modelsDir";
		case "theme":
			return "theme";
	}
}

interface LegacyPresetFields {
	binary_path?: string;
	theme?: string;
	default_model_dir?: string;
}

/**
 * Read only the legacy file-level fields from presets.json, without the
 * preset store's migration/corruption side effects — a pure fallback read
 * for `loadEffectiveConfig`.
 */
function readLegacyPresetFields(configDir: string): LegacyPresetFields {
	try {
		const raw = JSON.parse(
			readFileSync(join(configDir, "presets.json"), "utf8"),
		) as unknown;
		if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
			return {};
		}
		const r = raw as Record<string, unknown>;
		return {
			binary_path:
				typeof r.binary_path === "string" ? r.binary_path : undefined,
			theme: typeof r.theme === "string" ? r.theme : undefined,
			default_model_dir:
				typeof r.default_model_dir === "string"
					? r.default_model_dir
					: undefined,
		};
	} catch {
		return {};
	}
}

export interface EffectiveConfig {
	config: AppConfig;
	sources: Record<ConfigKey, ConfigSource>;
}

/**
 * Effective app settings: config.json wins for every key; presets.json
 * legacy fields are the fallback until consolidation migrates them.
 * The models-dir fallback is the `default_model_dir` seed (§5/§7).
 */
export function loadEffectiveConfig(configDir: string): EffectiveConfig {
	const owned = loadConfig(configDir);
	const legacy = readLegacyPresetFields(configDir);
	const config: AppConfig = { ...owned };
	const sources: Record<ConfigKey, ConfigSource> = {
		"binary-path": owned.binaryPath ? "config.json" : "unset",
		"models-dir": owned.modelsDir ? "config.json" : "unset",
		theme: owned.theme ? "config.json" : "unset",
	};
	if (!config.binaryPath && legacy.binary_path) {
		config.binaryPath = expandPath(legacy.binary_path);
		sources["binary-path"] = "presets.json (legacy)";
	}
	if (!config.theme && legacy.theme) {
		config.theme = legacy.theme;
		sources.theme = "presets.json (legacy)";
	}
	if (!config.modelsDir && legacy.default_model_dir) {
		config.modelsDir = expandPath(legacy.default_model_dir);
		sources["models-dir"] = "presets.json (legacy)";
	}
	return { config, sources };
}

/** Effective configured llama-server binary path (#69 owner: config.json). */
export function configuredBinaryPath(configDir: string): string | undefined {
	return loadEffectiveConfig(configDir).config.binaryPath;
}

export interface ConsolidateResult {
	/** CLI-spelling keys migrated from presets.json into config.json. */
	migrated: ConfigKey[];
	config: AppConfig;
	/** §5 backup of the pre-migration presets.json, when one was written. */
	backup?: string;
}

/**
 * One-time forward migration (#69, §5): copy file-level `binary_path` and
 * `theme` from presets.json into config.json for any key config.json does
 * not already own, then strip those fields from presets.json. The presets
 * rewrite goes through `savePresets` with a migration marker, so the
 * pre-migration file is preserved as `presets.json.bak` (`.bak.N` when a
 * backup already exists) exactly like the v1→v2 migration. Idempotent:
 * once stripped, later calls are no-ops and write nothing.
 * `default_model_dir` is deliberately NOT stripped — it stays as the
 * first-run models-dir seed until its own migration.
 */
export function consolidateLegacyConfig(configDir: string): ConsolidateResult {
	const owned = loadConfig(configDir);
	const legacy = readLegacyPresetFields(configDir);
	const migrated: ConfigKey[] = [];
	const next: AppConfig = { ...owned };
	if (legacy.binary_path && !owned.binaryPath) {
		next.binaryPath = expandPath(legacy.binary_path);
		migrated.push("binary-path");
	}
	if (legacy.theme && !owned.theme) {
		next.theme = legacy.theme;
		migrated.push("theme");
	}
	// Nothing to move if config already owns both keys — but still strip
	// legacy duplicates so presets.json converges on presets+lastSession.
	const hasLegacyDuplicates = Boolean(legacy.binary_path || legacy.theme);
	if (migrated.length === 0 && !hasLegacyDuplicates) {
		return { migrated, config: owned };
	}
	// Only write presets.json through the real store when it exists and is
	// loadable; a corrupt file was already preserved by loadPresets and
	// must not be clobbered by a consolidation write.
	if (!existsSync(join(configDir, "presets.json"))) {
		if (migrated.length > 0) saveConfig(configDir, next);
		return { migrated, config: next };
	}
	// Peek at the raw document first: if it is unparseable or shape-invalid,
	// bail WITHOUT calling loadPresets — that loader renames a corrupt file
	// to `.corrupt-<ts>` (#59), and consuming that rename here would hide
	// the corruption from the caller's own first load and its announcement.
	try {
		const raw = JSON.parse(
			readFileSync(join(configDir, "presets.json"), "utf8"),
		) as unknown;
		if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
			return { migrated: [], config: owned };
		}
		const rawPresets = (raw as Record<string, unknown>).presets;
		if (rawPresets !== undefined) {
			if (!Array.isArray(rawPresets)) return { migrated: [], config: owned };
			const loadable = rawPresets.every((p) => {
				if (typeof p !== "object" || p === null) return false;
				const entry = p as Record<string, unknown>;
				return (
					typeof entry.id === "string" &&
					typeof entry.name === "string" &&
					typeof entry.model_path === "string" &&
					(entry.flags === undefined ||
						(typeof entry.flags === "object" && entry.flags !== null))
				);
			});
			if (!loadable) return { migrated: [], config: owned };
		}
	} catch {
		return { migrated: [], config: owned };
	}
	const filePath = presetsFilePath(configDir);
	const loaded = loadPresets(filePath);
	if (loaded.corruptBackup || !loaded.data) {
		return { migrated: [], config: owned };
	}
	if (migrated.length > 0) saveConfig(configDir, next);
	const cleaned = { ...loaded.data };
	delete cleaned.binary_path;
	delete cleaned.theme;
	// Predict the §5 backup path savePresets will use.
	let backup = `${filePath}.bak`;
	let index = 1;
	while (existsSync(backup)) backup = `${filePath}.bak.${index++}`;
	savePresets(filePath, cleaned, { migratedFrom: 2 });
	return { migrated, config: next, backup };
}

/** Persist one CLI-facing key through the atomic config store (#69). */
export function setConfigValue(
	configDir: string,
	key: ConfigKey,
	value: string | undefined,
): AppConfig {
	const current = loadConfig(configDir);
	const next: AppConfig = { ...current };
	const field = configKeyField(key);
	if (value === undefined || value === "") {
		delete next[field];
	} else if (field === "theme") {
		next.theme = value;
	} else if (field === "binaryPath") {
		next.binaryPath = expandPath(value);
	} else {
		next.modelsDir = expandPath(value);
	}
	saveConfig(configDir, next);
	return next;
}
