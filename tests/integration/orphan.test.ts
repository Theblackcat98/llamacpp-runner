import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectOrphan, killOrphan } from "../../src/core/process/orphan";

const FAST = { sigintGraceMs: 400, sigkillGraceMs: 400 };

function scratch(): string {
	return mkdtempSync(join(tmpdir(), "llama-deck-orphan-"));
}

function writeRecord(dir: string, pid: number): string {
	const file = join(dir, "server.pid");
	writeFileSync(
		file,
		`${JSON.stringify({ pid, port: 18091, presetId: "t", startedAt: "now" })}\n`,
	);
	return file;
}

async function spawnFakeLlamaServer(): Promise<number> {
	const proc = Bun.spawn(["bash", "-c", "exec -a llama-server sleep 60"], {
		stdout: "ignore",
		stderr: "ignore",
	});
	await Bun.sleep(50);
	return proc.pid;
}

async function pidAlive(pid: number): Promise<boolean> {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

let dirs: string[] = [];
afterEach(() => {
	for (const d of dirs) rmSync(d, { recursive: true, force: true });
	dirs = [];
});

describe("orphan detection & recovery (§6.3)", () => {
	it("reports none when no pidfile exists", async () => {
		const dir = scratch();
		dirs.push(dir);
		expect(await inspectOrphan(join(dir, "server.pid"))).toEqual({
			status: "none",
		});
	});

	it("cleans stale pidfile silently (dead pid)", async () => {
		const dir = scratch();
		dirs.push(dir);
		const file = writeRecord(dir, 999_999_999);
		const result = await inspectOrphan(file);
		expect(result.status).toBe("stale");
		expect(existsSync(file)).toBe(false);
	});

	it("guards against pid reuse: live non-llama process is stale (P1-FR-15)", async () => {
		const dir = scratch();
		dirs.push(dir);
		const proc = Bun.spawn(["sleep", "30"], { stdout: "ignore" });
		try {
			const file = writeRecord(dir, proc.pid);
			const result = await inspectOrphan(file);
			expect(result.status).toBe("stale");
			expect(existsSync(file)).toBe(false);
		} finally {
			proc.kill();
		}
	});

	it("detects a live llama-server orphan and probes its port", async () => {
		const dir = scratch();
		dirs.push(dir);
		const pid = await spawnFakeLlamaServer();
		try {
			const file = writeRecord(dir, pid);
			const result = await inspectOrphan(file);
			expect(result.status).toBe("alive");
			expect(result.record?.pid).toBe(pid);
		} finally {
			process.kill(pid, "SIGKILL");
		}
	}, 10000);

	it("killOrphan terminates a live orphan within grace", async () => {
		const dir = scratch();
		dirs.push(dir);
		const pid = await spawnFakeLlamaServer();
		const ok = await killOrphan(pid, FAST);
		expect(ok).toBe(true);
		expect(await pidAlive(pid)).toBe(false);
	}, 10000);

	it("killOrphan on dead pid resolves true immediately", async () => {
		expect(await killOrphan(999_999_999, FAST)).toBe(true);
	});
});
