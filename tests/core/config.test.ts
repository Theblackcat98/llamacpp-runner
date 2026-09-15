import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
	expandPath,
	loadConfig,
	saveConfig,
} from "../../src/core/store/config";

const TEST_DIR = resolve(".tmp/config-tilde-test");

afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("expandPath (~ expansion)", () => {
	it("expands ~ to homedir", () => {
		expect(expandPath("~")).toBe(homedir());
	});

	it("expands ~/path to homedir/path", () => {
		expect(expandPath("~/models/llm")).toBe(join(homedir(), "models/llm"));
	});

	it("expands ~\\path on windows", () => {
		expect(expandPath("~\\models\\llm")).toBe(join(homedir(), "models\\llm"));
	});

	it("does not expand paths not starting with ~", () => {
		expect(expandPath("/opt/models")).toBe("/opt/models");
		expect(expandPath("./relative/models")).toBe("./relative/models");
		expect(expandPath("~username/models")).toBe("~username/models");
	});
});

describe("config store ~ expansion (Issue #28)", () => {
	it("expands ~ in modelsDir when saving config", () => {
		const dir = join(TEST_DIR, "save");
		mkdirSync(dir, { recursive: true });

		saveConfig(dir, { modelsDir: "~/models/llm" });

		const raw = JSON.parse(readFileSync(join(dir, "config.json"), "utf8")) as {
			modelsDir?: string;
		};
		expect(raw.modelsDir).toBe(join(homedir(), "models/llm"));
	});

	it("expands ~ in modelsDir when loading legacy unexpanded config", () => {
		const dir = join(TEST_DIR, "load");
		mkdirSync(dir, { recursive: true });

		writeFileSync(
			join(dir, "config.json"),
			JSON.stringify({ modelsDir: "~/models/llm" }),
			"utf8",
		);

		const loaded = loadConfig(dir);
		expect(loaded.modelsDir).toBe(join(homedir(), "models/llm"));
	});

	it("leaves modelsDir undefined when config has no modelsDir", () => {
		const dir = join(TEST_DIR, "empty");
		mkdirSync(dir, { recursive: true });

		const loaded = loadConfig(dir);
		expect(loaded.modelsDir).toBeUndefined();
	});
});
