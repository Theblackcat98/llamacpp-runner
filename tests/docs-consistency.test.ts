import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TAB_LABELS } from "../src/ui/app";
import { THEME_NAMES } from "../src/ui/themes";

/**
 * Docs consistency (#22): the README is the user's contract for tabs,
 * themes, keybindings, and the Bun baseline. These assertions fail loudly
 * when the implementation moves and the docs don't follow.
 */
const README = readFileSync(join(__dirname, "..", "README.md"), "utf-8");
const PKG = JSON.parse(
	readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
) as { packageManager?: string };

describe("README docs consistency", () => {
	it("names every registered theme", () => {
		for (const name of THEME_NAMES) {
			expect(
				README.includes(name),
				`README must document the "${name}" theme`,
			).toBe(true);
		}
	});

	it("documents tabs 3/4 in the app's actual order (Telemetry before Presets)", () => {
		expect(TAB_LABELS[2]).toBe("Server Telemetry");
		expect(TAB_LABELS[3]).toBe("Presets");
		expect(README).toContain("`3`");
		expect(README).toContain("Server Telemetry");
		expect(README).toContain("`4`");
		expect(README).toContain("Presets");
	});

	it("documents the `t` key on the Telemetry tab, not Configure", () => {
		const tRow = README.split("\n").find(
			(line) => line.startsWith("| `t`") && line.includes("Telemetry"),
		);
		expect(tRow, "README must scope `t` to Server Telemetry").toBeDefined();
		expect(README).not.toMatch(/\|\s*`t`\s*\|\s*Configure/);
	});

	it("reflects the pinned Bun baseline from packageManager", () => {
		const pinned = PKG.packageManager ?? "";
		expect(pinned).toMatch(/^bun@/);
		const version = pinned.replace(/^bun@/, "");
		expect(
			README.includes(version),
			`README must mention the pinned Bun version ${version}`,
		).toBe(true);
	});

	it("lists the headless CLI commands the CLI actually supports", () => {
		for (const cmd of [
			"scan",
			"list",
			"quick",
			"presets",
			"export",
			"import",
			"start",
			"kill",
		]) {
			expect(
				README.includes(`cli ${cmd}`),
				`README CLI section must document \`bun run cli ${cmd}\``,
			).toBe(true);
		}
	});
});
