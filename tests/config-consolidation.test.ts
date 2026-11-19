import { afterEach, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	consolidateLegacyConfig,
	loadConfig,
	loadEffectiveConfig,
	normalizeConfigKey,
	saveConfig,
	setConfigValue,
} from "../src/core/store/config";
import {
	loadPresets,
	type PresetFile,
	presetsFilePath,
	savePresets,
} from "../src/core/store/presets";

const DIRS: string[] = [];
function scratch(): string {
	const dir = mkdtempSync(join(tmpdir(), "llama-deck-config69-"));
	DIRS.push(dir);
	return dir;
}
afterEach(() => {
	for (const d of DIRS.splice(0)) rmSync(d, { recursive: true, force: true });
});

const PRESET = {
	id: "p1",
	name: "P1",
	model_path: "/models/a.gguf",
	flags: {},
	env_vars: {},
	created_at: "2026-01-01T00:00:00Z",
	last_used: null,
};

function writeLegacyStore(configDir: string, doc: PresetFile): void {
	mkdirSync(configDir, { recursive: true });
	savePresets(presetsFilePath(configDir), doc);
}

describe("config ownership consolidation (#69, §5)", () => {
	it("migrates binary_path + theme from presets.json into config.json, strips them, and writes a .bak", () => {
		const configDir = scratch();
		writeLegacyStore(configDir, {
			version: 2,
			binary_path: "/opt/bin/llama-server",
			theme: "nord",
			default_model_dir: "~/models/llm",
			lastSession: { preset_id: "p1", tab: 1 },
			presets: [PRESET],
		});
		const result = consolidateLegacyConfig(configDir);
		expect(result.migrated).toEqual(["binary-path", "theme"]);
		expect(result.backup).toBe(join(configDir, "presets.json.bak"));
		// config.json is now the owner and is actually read back.
		const cfg = loadConfig(configDir);
		expect(cfg.binaryPath).toBe("/opt/bin/llama-server");
		expect(cfg.theme).toBe("nord");
		// presets.json keeps presets + lastSession + the seed, loses the rest.
		const after = loadPresets(presetsFilePath(configDir)).data;
		expect(after?.binary_path).toBeUndefined();
		expect(after?.theme).toBeUndefined();
		expect(after?.default_model_dir).toBe("~/models/llm");
		expect(after?.lastSession).toEqual({ preset_id: "p1", tab: 1 });
		expect(after?.presets).toHaveLength(1);
		// §5 backup holds the pre-migration document verbatim.
		const bak = JSON.parse(
			readFileSync(join(configDir, "presets.json.bak"), "utf8"),
		) as PresetFile;
		expect(bak.binary_path).toBe("/opt/bin/llama-server");
		expect(bak.theme).toBe("nord");
	});

	it("is idempotent: a second run migrates nothing and writes no new backup", () => {
		const configDir = scratch();
		writeLegacyStore(configDir, {
			version: 2,
			binary_path: "/bin/llama-server",
			presets: [],
		});
		consolidateLegacyConfig(configDir);
		const second = consolidateLegacyConfig(configDir);
		expect(second.migrated).toEqual([]);
		expect(second.backup).toBeUndefined();
		expect(existsSync(join(configDir, "presets.json.bak.1"))).toBe(false);
	});

	it("config.json wins over legacy values; legacy duplicates are still stripped", () => {
		const configDir = scratch();
		saveConfig(configDir, { binaryPath: "/new/llama-server", theme: "nord" });
		writeLegacyStore(configDir, {
			version: 2,
			binary_path: "/old/llama-server",
			theme: "gruvbox",
			presets: [],
		});
		const result = consolidateLegacyConfig(configDir);
		expect(result.migrated).toEqual([]);
		expect(loadConfig(configDir).binaryPath).toBe("/new/llama-server");
		expect(loadConfig(configDir).theme).toBe("nord");
		expect(
			loadPresets(presetsFilePath(configDir)).data?.binary_path,
		).toBeUndefined();
	});

	it("no legacy fields -> no writes at all", () => {
		const configDir = scratch();
		writeLegacyStore(configDir, { version: 2, presets: [PRESET] });
		const result = consolidateLegacyConfig(configDir);
		expect(result.migrated).toEqual([]);
		expect(existsSync(join(configDir, "presets.json.bak"))).toBe(false);
		expect(existsSync(join(configDir, "config.json"))).toBe(false);
	});

	it("loadEffectiveConfig reports value + source for owner, legacy, and unset", () => {
		const configDir = scratch();
		writeLegacyStore(configDir, {
			version: 2,
			binary_path: "/legacy/llama-server",
			theme: "everforest",
			default_model_dir: "/models/seed",
			presets: [],
		});
		let eff = loadEffectiveConfig(configDir);
		expect(eff.config.binaryPath).toBe("/legacy/llama-server");
		expect(eff.sources["binary-path"]).toBe("presets.json (legacy)");
		expect(eff.sources.theme).toBe("presets.json (legacy)");
		expect(eff.config.modelsDir).toBe("/models/seed");
		expect(eff.sources["models-dir"]).toBe("presets.json (legacy)");

		saveConfig(configDir, { binaryPath: "/owned/llama-server" });
		eff = loadEffectiveConfig(configDir);
		expect(eff.config.binaryPath).toBe("/owned/llama-server");
		expect(eff.sources["binary-path"]).toBe("config.json");

		const empty = loadEffectiveConfig(scratch());
		expect(empty.config.binaryPath).toBeUndefined();
		expect(empty.sources["binary-path"]).toBe("unset");
	});

	it("round-trips set/get through the atomic store, including hardware cache preservation", () => {
		const configDir = scratch();
		saveConfig(configDir, {
			hardware: {
				kind: "cpu",
				vramBytes: null,
				totalMemBytes: 1024,
				source: "test",
			},
		});
		setConfigValue(configDir, "binary-path", "/usr/local/bin/llama-server");
		setConfigValue(configDir, "models-dir", "~/models/llm");
		setConfigValue(configDir, "theme", "nord");
		const cfg = loadConfig(configDir);
		expect(cfg.binaryPath).toBe("/usr/local/bin/llama-server");
		expect(cfg.modelsDir).toEndWith(join("models", "llm"));
		expect(cfg.theme).toBe("nord");
		expect(cfg.hardware?.kind).toBe("cpu");
		// Empty value clears the key.
		setConfigValue(configDir, "theme", "");
		expect(loadConfig(configDir).theme).toBeUndefined();
	});

	it("normalizeConfigKey accepts CLI and on-disk spellings", () => {
		expect(normalizeConfigKey("binary-path")).toBe("binary-path");
		expect(normalizeConfigKey("binary_path")).toBe("binary-path");
		expect(normalizeConfigKey("binaryPath")).toBe("binary-path");
		expect(normalizeConfigKey("models-dir")).toBe("models-dir");
		expect(normalizeConfigKey("modelsDir")).toBe("models-dir");
		expect(normalizeConfigKey("theme")).toBe("theme");
		expect(normalizeConfigKey("nope")).toBeNull();
	});
});

describe("core preset management helpers (#69 CLI parity)", () => {
	it("delete / rename / set-default transform the file purely", async () => {
		const { deletePresetFromFile, renamePresetInFile, setDefaultPresetInFile } =
			await import("../src/core/store/presets");
		const file: PresetFile = {
			version: 2,
			lastSession: { preset_id: "p1", tab: 1 },
			presets: [PRESET, { ...PRESET, id: "p2", name: "P2" }],
		};
		const renamed = renamePresetInFile(file, "p1", "Renamed");
		expect(renamed.renamed?.name).toBe("Renamed");
		expect(renamed.file.presets[0]?.name).toBe("Renamed");
		expect(file.presets[0]?.name).toBe("P1");

		const def = setDefaultPresetInFile(file, "P2");
		expect(def.file.lastSession).toEqual({ preset_id: "p2", tab: 3 });

		const del = deletePresetFromFile(file, "p1");
		expect(del.removed?.id).toBe("p1");
		expect(del.file.presets).toHaveLength(1);
		expect(del.file.lastSession).toBeUndefined();

		expect(deletePresetFromFile(file, "nope").removed).toBeUndefined();
		expect(renamePresetInFile(file, "nope", "X").renamed).toBeUndefined();
		expect(setDefaultPresetInFile(file, "nope").preset).toBeUndefined();
	});
});
