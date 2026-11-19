import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
	type PresetFile,
	presetsFilePath,
	savePresets,
} from "../src/core/store/presets";

const TEST_DIR = resolve(".tmp/cli-config69-test");
const configHome = join(TEST_DIR, "config");
const deckConfigDir = join(configHome, "llama-deck");
const stateDir = join(TEST_DIR, "state");

function cli(args: string[]) {
	return Bun.spawnSync([process.execPath, "src/cli.ts", ...args], {
		env: {
			...process.env,
			XDG_CONFIG_HOME: configHome,
			XDG_STATE_HOME: stateDir,
		},
	});
}

const PRESET_A = {
	id: "pa",
	name: "Alpha",
	model_path: "/models/a.gguf",
	flags: {},
	env_vars: {},
	created_at: "2026-01-01T00:00:00Z",
	last_used: null,
};
const PRESET_B = { ...PRESET_A, id: "pb", name: "Beta" };

beforeAll(() => {
	mkdirSync(deckConfigDir, { recursive: true });
	mkdirSync(stateDir, { recursive: true });
});
afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("CLI help flags (audit CLI polish)", () => {
	it("-h exits 0 with help", () => {
		const proc = cli(["-h"]);
		expect(proc.exitCode).toBe(0);
		expect(proc.stdout.toString()).toContain("llama-deck");
	});

	it("<subcommand> --help exits 0 and is never treated as a preset name", () => {
		for (const cmd of ["doctor", "export", "start", "import", "quick"]) {
			const proc = cli([cmd, "--help"]);
			expect(proc.exitCode).toBe(0);
			expect(proc.stdout.toString()).toContain(`llama-deck ${cmd}`);
			expect(proc.stderr.toString()).not.toContain("Unknown preset");
		}
		const proc = cli(["doctor", "-h"]);
		expect(proc.exitCode).toBe(0);
	});

	it("help <subcommand> exits 0 with subcommand usage", () => {
		const proc = cli(["help", "config"]);
		expect(proc.exitCode).toBe(0);
		expect(proc.stdout.toString()).toContain("config set");
	});

	it("bare invocation still exits 0 with help (TUI is `tui`)", () => {
		const proc = cli([]);
		expect(proc.exitCode).toBe(0);
		expect(proc.stdout.toString()).toContain("llama-deck tui");
	});
});

describe("llama-deck config get|set (#69)", () => {
	it("set persists to config.json via the atomic store; get prints value + source", () => {
		rmSync(deckConfigDir, { recursive: true, force: true });
		mkdirSync(deckConfigDir, { recursive: true });
		expect(
			cli(["config", "set", "binary-path", "/opt/bin/llama-server"]).exitCode,
		).toBe(0);
		expect(cli(["config", "set", "models-dir", "/data/models"]).exitCode).toBe(
			0,
		);
		expect(cli(["config", "set", "theme", "nord"]).exitCode).toBe(0);

		const onDisk = JSON.parse(
			readFileSync(join(deckConfigDir, "config.json"), "utf8"),
		);
		expect(onDisk.binaryPath).toBe("/opt/bin/llama-server");
		expect(onDisk.modelsDir).toBe("/data/models");
		expect(onDisk.theme).toBe("nord");

		const get = cli(["config", "get", "binary-path"]);
		expect(get.exitCode).toBe(0);
		expect(get.stdout.toString()).toContain("/opt/bin/llama-server");
		expect(get.stdout.toString()).toContain("config.json");

		const getJson = cli(["config", "get", "theme", "--json"]);
		expect(JSON.parse(getJson.stdout.toString())).toEqual({
			value: "nord",
			source: "config.json",
		});

		const all = cli(["config", "get"]);
		expect(all.stdout.toString()).toContain("models-dir: /data/models");
	});

	it("get reports the legacy source before migration and unset keys honestly", () => {
		rmSync(deckConfigDir, { recursive: true, force: true });
		mkdirSync(deckConfigDir, { recursive: true });
		savePresets(presetsFilePath(deckConfigDir), {
			version: 2,
			binary_path: "/legacy/llama-server",
			theme: "gruvbox",
			presets: [],
		} as PresetFile);
		const get = cli(["config", "get", "binary-path"]);
		expect(get.stdout.toString()).toContain("/legacy/llama-server");
		expect(get.stdout.toString()).toContain("presets.json (legacy)");
		// get is read-only: no config.json written, no .bak produced.
		expect(existsSync(join(deckConfigDir, "config.json"))).toBe(false);
		expect(existsSync(join(deckConfigDir, "presets.json.bak"))).toBe(false);

		const unset = cli(["config", "get", "models-dir"]);
		expect(unset.stdout.toString()).toContain("(unset)");
	});

	it("a later non-get command performs the one-time migration with a .bak", () => {
		const list = cli(["presets"]);
		expect(list.exitCode).toBe(0);
		expect(existsSync(join(deckConfigDir, "presets.json.bak"))).toBe(true);
		const cfg = JSON.parse(
			readFileSync(join(deckConfigDir, "config.json"), "utf8"),
		);
		expect(cfg.binaryPath).toBe("/legacy/llama-server");
		expect(cfg.theme).toBe("gruvbox");
		const after = cli(["config", "get", "binary-path"]);
		expect(after.stdout.toString()).toContain("config.json");
	});

	it("unknown keys and missing values are usage errors (exit 2)", () => {
		expect(cli(["config", "set", "nope", "x"]).exitCode).toBe(2);
		expect(cli(["config", "get", "nope"]).exitCode).toBe(2);
		expect(cli(["config", "set", "theme"]).exitCode).toBe(2);
		expect(cli(["config", "frob"]).exitCode).toBe(2);
	});
});

describe("CLI preset management parity (#69)", () => {
	beforeAll(() => {
		savePresets(presetsFilePath(deckConfigDir), {
			version: 2,
			presets: [PRESET_A, PRESET_B],
		});
	});

	it("rename changes the name and keeps the id", () => {
		const proc = cli(["presets", "rename", "pa", "Alpha Prime"]);
		expect(proc.exitCode).toBe(0);
		const list = cli(["presets"]).stdout.toString();
		expect(list).toContain("pa\tAlpha Prime");
	});

	it("set-default writes lastSession for the preset", () => {
		expect(cli(["presets", "set-default", "pb"]).exitCode).toBe(0);
		const doc = JSON.parse(
			readFileSync(presetsFilePath(deckConfigDir), "utf8"),
		) as PresetFile;
		expect(doc.lastSession?.preset_id).toBe("pb");
	});

	it("delete removes the preset; unknown presets exit 1; bad actions exit 2", () => {
		expect(cli(["presets", "delete", "pa"]).exitCode).toBe(0);
		expect(cli(["presets"]).stdout.toString()).not.toContain("Alpha");
		expect(cli(["presets", "delete", "pa"]).exitCode).toBe(1);
		expect(cli(["presets", "rename", "nope", "X"]).exitCode).toBe(1);
		expect(cli(["presets", "set-default", "nope"]).exitCode).toBe(1);
		expect(cli(["presets", "frob"]).exitCode).toBe(2);
		expect(cli(["presets", "delete"]).exitCode).toBe(2);
		// Plain listing still works and is unchanged in shape.
		const list = cli(["presets", "--json"]);
		expect(JSON.parse(list.stdout.toString())).toHaveLength(1);
	});
});

describe("package bin entry (audit CLI polish)", () => {
	it("package.json declares the llama-deck bin at the CLI entry", () => {
		const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
			bin?: Record<string, string>;
		};
		expect(pkg.bin?.["llama-deck"]).toBe("src/cli.ts");
		const cliHead = readFileSync("src/cli.ts", "utf8").slice(0, 40);
		expect(cliHead).toContain("#!/usr/bin/env bun");
		// The file the bin points at is the help the tests above exercised.
		writeFileSync(join(TEST_DIR, "marker"), cliHead);
	});
});
