import { afterAll, describe, expect, it } from "bun:test";
import * as net from "node:net";
import { resolve } from "node:path";
import { isPidAlive } from "../../src/core/process/identity";
import { Supervisor } from "../../src/core/process/supervisor";

const FIXTURE = resolve(import.meta.dir, "../fixtures/fake-server.sh");
const FAST = { sigintGraceMs: 400, sigkillGraceMs: 400 };
const READY = /listening on/;

interface Run {
	states: string[];
	details: (string | undefined)[];
	lines: string[];
	exitCode?: number;
	sv: Supervisor;
	waitExit: (timeoutMs?: number) => Promise<void>;
	waitReady: () => Promise<boolean>;
}

async function runFixture(args: string[], port?: number): Promise<Run> {
	const sv = new Supervisor({
		command: "bash",
		args: [FIXTURE, ...args],
		port,
		readyPattern: READY,
		timings: FAST,
	});
	const states: string[] = [];
	const details: (string | undefined)[] = [];
	const lines: string[] = [];
	let resolveExit: (() => void) | undefined;
	const exited = new Promise<void>((r) => {
		resolveExit = r;
	});
	sv.onState((e) => {
		states.push(e.state);
		details.push(e.detail);
		if (e.exitCode !== undefined) run.exitCode = e.exitCode;
		if (e.state === "FAILED" || e.state === "IDLE") resolveExit?.();
	});
	sv.onLog((l) => lines.push(l));
	const run: Run = {
		states,
		details,
		lines,
		sv,
		waitExit: async (timeoutMs = 8000) => {
			await Promise.race([exited, bunSleep(timeoutMs)]);
		},
		waitReady: () => waitFor(() => states.includes("READY")),
	};
	await sv.start();
	return run;
}

function bunSleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(
	cond: () => boolean | Promise<boolean>,
	timeoutMs = 3000,
): Promise<boolean> {
	const started = Date.now();
	while (!(await cond())) {
		if (Date.now() - started > timeoutMs) return false;
		await bunSleep(10);
	}
	return true;
}

async function pidAlive(pid: number): Promise<boolean> {
	return isPidAlive(pid);
}

describe("supervisor vs fake-server.sh (§6)", () => {
	it("reaches READY and tears down cleanly on SIGINT within grace (P1-FR-11,16)", async () => {
		const run = await runFixture(["--port", "18081"], 18081);
		expect(await run.waitReady()).toBe(true);
		expect(run.states).toContain("STARTING");
		expect(run.states).toContain("LOADING");
		expect(run.states).toContain("READY");
		const t0 = Date.now();
		const info = await run.sv.kill();
		expect(Date.now() - t0).toBeLessThan(FAST.sigintGraceMs + 1000);
		expect(info?.code).toBe(0);
	});

	it("collapses \\r progress into a single line end-to-end (P1-FR-08)", async () => {
		const run = await runFixture(["--port", "18082", "--progress-steps", "5"]);
		await run.waitReady();
		const progressLines = run.lines.filter((l) => l.includes("load "));
		expect(progressLines).toHaveLength(1);
		const [only] = progressLines;
		expect(only).toBe("load 100%");
		await run.sv.kill();
	});

	it("preserves ANSI escapes in delivered log lines (P1-FR-09)", async () => {
		const run = await runFixture(["--port", "18083"]);
		await run.waitReady();
		expect(run.lines.some((l) => l.includes("\x1b[32m"))).toBe(true);
		await run.sv.kill();
	});

	it("non-zero exit surfaces FAILED with tail (P1-FR-17)", async () => {
		const run = await runFixture([
			"--port",
			"18084",
			"--crash-after",
			"0.2",
			"--exit-code",
			"1",
		]);
		await run.waitExit(5000);
		expect(run.states).toContain("FAILED");
		expect(run.lines.some((l) => l.includes("CUDA out of memory"))).toBe(true);
		expect(
			run.sv.snapshotTail().some((l) => l.includes("CUDA out of memory")),
		).toBe(true);
	});

	it("SIGKILL path terminates an INT-immune child within worst case (P1-NFR-03)", async () => {
		const t0 = Date.now();
		const run = await runFixture(["--port", "18085", "--ignore-int"]);
		await run.sv.kill();
		expect(Date.now() - t0).toBeLessThan(
			FAST.sigintGraceMs + FAST.sigkillGraceMs + 1500,
		);
	}, 20000);

	it("teardown is idempotent under concurrent calls (P1-FR-11)", async () => {
		const sv = new Supervisor({
			command: "bash",
			args: [FIXTURE, "--port", "18086"],
			timings: FAST,
		});
		await sv.start();
		const [a, b] = await Promise.all([sv.kill(), sv.kill()]);
		expect(a).toEqual(b);
		await expect(sv.kill()).resolves.toEqual(a);
	});

	it("kill during in-flight spawn waits for handle then tears down (P1-FR-13)", async () => {
		const sv = new Supervisor({
			command: "bash",
			args: [FIXTURE, "--port", "18087", "--start-delay", "0.3"],
			timings: FAST,
		});
		const startP = sv.start();
		const killP = sv.kill();
		await startP;
		const info = await killP;
		expect(sv.isRunning).toBe(false);
		expect(info?.code === 0 || info?.signal !== null).toBe(true);
	});

	it("port pre-flight blocks spawn when port occupied (§7)", async () => {
		const blocker = net.createServer();
		await new Promise<void>((r) => blocker.listen(18088, "127.0.0.1", r));
		try {
			const run = await runFixture(["--port", "18088"], 18088);
			expect(run.details).toContain("port_in_use");
			expect(run.sv.pid).toBeUndefined();
			expect(run.states).not.toContain("STARTING");
		} finally {
			await new Promise<void>((r) => blocker.close(() => r()));
		}
	});

	it("missing binary reports binary_not_found without spawning (§7)", async () => {
		const sv = new Supervisor({
			command: "definitely-not-a-real-binary-xyz",
			args: [],
			timings: FAST,
			whichFn: () => null,
		});
		const states: string[] = [];
		const details: (string | undefined)[] = [];
		sv.onState((e) => {
			states.push(e.state);
			details.push(e.detail);
		});
		await sv.start();
		expect(details).toContain("binary_not_found");
		expect(states[states.length - 1]).toBe("FAILED");
		expect(sv.pid).toBeUndefined();
	});

	it("can restart after a previous run exits", async () => {
		const port = 18101;
		const sv = new Supervisor({
			command: "bash",
			args: [FIXTURE, "--port", String(port)],
			port,
			readyPattern: READY,
			timings: FAST,
		});
		const states: string[] = [];
		sv.onState((e) => states.push(e.state));
		await sv.start();
		expect(await waitFor(() => states.includes("READY"))).toBe(true);
		await sv.kill();
		const firstPid = sv.pid;
		await sv.start();
		expect(
			await waitFor(() => states.filter((s) => s === "READY").length === 2),
		).toBe(true);
		expect(sv.pid).not.toBe(firstPid);
		await sv.kill();
	});

	it("does not emit READY from late output after exit", async () => {
		let data: ((chunk: string) => void) | undefined;
		let exit:
			| ((info: { code: number; signal: string | null }) => void)
			| undefined;
		const sv = new Supervisor({
			command: "fake",
			args: [],
			transportFactory: () => ({
				pid: 12345,
				onData(cb) {
					data = cb;
				},
				onExit(cb) {
					exit = cb;
				},
				kill() {
					return true;
				},
			}),
			whichFn: () => "/bin/fake",
			readyPattern: /ready/,
		});
		const states: string[] = [];
		sv.onState((e) => states.push(e.state));
		await sv.start();
		exit?.({ code: 0, signal: null });
		data?.("ready\\n");
		expect(states.filter((s) => s === "READY")).toHaveLength(0);
	});

	it("zero-exit after READY reports clean stop, not FAILED (P1-FR-16)", async () => {
		const run = await runFixture(["--port", "18089"]);
		await run.waitReady();
		await run.sv.kill();
		const lastState = run.states[run.states.length - 1] ?? "";
		expect(["IDLE"]).toContain(lastState);
		expect(run.exitCode).toBe(0);
	});

	it("child process leaves no orphan behind teardown (EXIT criterion)", async () => {
		const sv = new Supervisor({
			command: "bash",
			args: [FIXTURE, "--port", "18090"],
			timings: FAST,
		});
		await sv.start();
		const pid = sv.pid;
		if (pid === undefined) throw new Error("expected pid after start");
		expect(await pidAlive(pid)).toBe(true);
		await sv.kill();
		await waitFor(async () => !(await pidAlive(pid)), 5000);
		expect(await pidAlive(pid)).toBe(false);
	});
});

afterAll(() => {});
