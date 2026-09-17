import { describe, expect, it } from "bun:test";
import * as net from "node:net";
import { createBus } from "../../src/core/bus";
import type { IntentMap, StateMap } from "../../src/core/bus-contract";
import { createSession, type Session } from "../../src/core/session";
import { readPidFile } from "../../src/core/store/pidfile";
import { resolvePaths } from "../../src/core/store/state-paths";

const FIXTURE = new URL("../fixtures/fake-server.sh", import.meta.url).pathname;
const READY = /listening on/;

function makeSession(port: number): Session {
	const bus = createBus<IntentMap, StateMap>();
	return createSession({
		command: "bash",
		args: [FIXTURE, "--port", String(port)],
		port,
		presetId: "test-preset",
		paths: resolvePaths(),
		bus,
		supervisor: new (require("../../src/core/process/supervisor").Supervisor)({
			command: "bash",
			args: [FIXTURE, "--port", String(port)],
			port,
			readyPattern: READY,
			timings: { sigintGraceMs: 400, sigkillGraceMs: 400 },
		}),
	});
}

async function waitFor(
	cond: () => boolean | Promise<boolean>,
	timeoutMs = 5000,
): Promise<boolean> {
	const started = Date.now();
	while (!(await cond())) {
		if (Date.now() - started > timeoutMs) return false;
		await Bun.sleep(10);
	}
	return true;
}

describe("session end-to-end (P1-FR-01,04; EXIT criterion)", () => {
	it("launch via intent → logs flow through bus → pidfile lifecycle → quit leaves no orphan", async () => {
		const port = 18096;
		const blockerFree = await portUsable(port);
		expect(blockerFree).toBe(true);
		const session = makeSession(port);

		const states: string[] = [];
		let sawReady = false;
		session.bus.onState("PROC_STATE", (e) => {
			states.push(e.state);
			if (e.state === "READY") sawReady = true;
		});
		const logLines: string[] = [];
		session.bus.onState("LOG_LINE", (e) => logLines.push(e.text));

		await session.boot();
		session.bus.emitIntent("LAUNCH", { presetId: "test-preset" });
		const starter = session.supervisor;
		if (!starter) throw new Error("expected supervisor");
		await starter.start();
		await waitFor(() => sawReady);
		expect(sawReady).toBe(true);
		expect(logLines.some((l) => l.includes("listening on"))).toBe(true);

		// Re-read: the async LAUNCH swaps in a fresh supervisor instance,
		// and the pidfile tracks whichever instance actually launched.
		const current = session.supervisor;
		if (!current) throw new Error("expected supervisor");
		const pid = current.pid;
		expect(pid).toBeDefined();
		await waitFor(() => readPidFile(resolvePaths().pidFile)?.pid === pid);
		expect(readPidFile(resolvePaths().pidFile)?.port).toBe(port);

		await session.shutdown();
		await waitFor(() => readPidFile(resolvePaths().pidFile) === null);
		expect(readPidFile(resolvePaths().pidFile)).toBeNull();

		if (pid !== undefined) {
			await waitFor(async () => !(await procAlive(pid)), 5000);
			expect(await procAlive(pid)).toBe(false);
		}
	}, 20000);

	it("boot detects a live orphan and killFoundOrphan removes it (P1-FR-15)", async () => {
		const stray = Bun.spawn(["bash", "-c", "exec -a llama-server sleep 60"], {
			stdout: "ignore",
			stderr: "ignore",
		});
		await Bun.sleep(300);
		try {
			const paths = resolvePaths();
			writePidRecord(paths.pidFile, stray.pid);
			const session = makeSession(18097);
			let orphanPid: number | undefined;
			session.bus.onState("ORPHAN_FOUND", (e) => {
				orphanPid = e.pid;
			});

			await session.boot();
			await waitFor(() => orphanPid !== undefined);
			expect(orphanPid).toBe(stray.pid);

			const killed = await session.killFoundOrphan();
			expect(killed).toBe(true);
			await waitFor(async () => !(await procAlive(stray.pid)), 5000);
			expect(await procAlive(stray.pid)).toBe(false);
			expect(readPidFile(paths.pidFile)).toBeNull();
		} finally {
			stray.kill("SIGKILL");
		}
	}, 15000);
});

function writePidRecord(file: string, pid: number): void {
	require("node:fs").writeFileSync(
		file,
		`${JSON.stringify({ pid, port: 18097, presetId: "x", startedAt: "now" })}\n`,
	);
}

async function procAlive(pid: number): Promise<boolean> {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function portUsable(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = net.createServer();
		server.once("error", () => resolve(false));
		server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
	});
}

describe("pidfile hygiene (#61)", () => {
	it("KILL clears the pidfile only after the kill settles", async () => {
		const port = 18095;
		const session = makeSession(port);
		await session.boot();
		const sup = session.supervisor;
		if (!sup) throw new Error("expected supervisor");
		await sup.start();
		const pidFile = resolvePaths().pidFile;
		const appeared = await waitFor(() => readPidFile(pidFile)?.pid === sup.pid);
		expect(appeared).toBe(true);

		// Synchronously after KILL dispatch the §6.3 recovery record must
		// still exist — the old code cleared it before signaling.
		session.bus.emitIntent("KILL", {});
		expect(readPidFile(pidFile)).not.toBeNull();

		// After teardown settles, the record is gone.
		expect(await waitFor(() => readPidFile(pidFile) === null)).toBe(true);
		await session.shutdown();
	}, 20000);
});
