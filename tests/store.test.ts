import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	clearPidFile,
	readPidFile,
	writePidFile,
} from "../src/core/store/pidfile";
import { resolvePaths } from "../src/core/store/state-paths";

function scratch(): string {
	return mkdtempSync(join(tmpdir(), "llama-deck-test-"));
}

describe("state paths (P1-FR-19)", () => {
	it("defaults under home when XDG vars absent", () => {
		const p = resolvePaths({}, "/home/tester");
		expect(p.stateDir).toBe(join("/home/tester", ".local/state/llama-deck"));
		expect(p.configDir).toBe(join("/home/tester", ".config/llama-deck"));
		expect(p.pidFile).toBe(
			join("/home/tester", ".local/state/llama-deck/server.pid"),
		);
	});

	it("honors XDG_STATE_HOME and XDG_CONFIG_HOME independently", () => {
		const p = resolvePaths(
			{ XDG_STATE_HOME: "/tmp/st", XDG_CONFIG_HOME: "/tmp/cf" },
			"/home/x",
		);
		expect(p.stateDir).toBe(join("/tmp/st", "llama-deck"));
		expect(p.configDir).toBe(join("/tmp/cf", "llama-deck"));
	});
});

describe("pidfile store (P1-FR-14)", () => {
	let dir: string;
	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	it("round-trips a pid record", () => {
		dir = scratch();
		const file = join(dir, "state", "server.pid");
		writePidFile(file, {
			pid: 4242,
			port: 8080,
			presetId: "qwen",
			startedAt: "2026-08-24T00:00:00Z",
		});
		const rec = readPidFile(file);
		expect(rec?.pid).toBe(4242);
		expect(rec?.port).toBe(8080);
	});

	it("writes atomically: temp file gone after write (§5)", () => {
		dir = scratch();
		const file = join(dir, "server.pid");
		writePidFile(file, { pid: 1, startedAt: "t" });
		expect(existsSync(file)).toBe(true);
		const leftovers = readFileSync(file).length > 0;
		expect(leftovers).toBe(true);
		expect(existsSync(`${dir}/.server.pid.tmp-${process.pid}`)).toBe(false);
	});

	it("creates missing parent dirs", () => {
		dir = scratch();
		const file = join(dir, "deep", "nested", "server.pid");
		writePidFile(file, { pid: 7, startedAt: "t" });
		expect(readPidFile(file)?.pid).toBe(7);
	});

	it("returns null for missing or corrupt files", () => {
		dir = scratch();
		expect(readPidFile(join(dir, "nope.pid"))).toBeNull();
		const bad = join(dir, "bad.pid");
		writeFileSyncBad(bad);
		expect(readPidFile(bad)).toBeNull();
	});

	it("clear removes the file idempotently", () => {
		dir = scratch();
		const file = join(dir, "server.pid");
		clearPidFile(file);
		writePidFile(file, { pid: 9, startedAt: "t" });
		clearPidFile(file);
		expect(existsSync(file)).toBe(false);
		expect(() => clearPidFile(file)).not.toThrow();
	});
});

function writeFileSyncBad(path: string): void {
	require("node:fs").writeFileSync(path, "{not json");
}
