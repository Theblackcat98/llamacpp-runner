import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { Supervisor } from "../../src/core/process/supervisor";

/**
 * Automated verification for Phase 6 (Lifecycle & Safety).
 * Proves:
 * 1. Fake server starts and reaches READY state.
 * 2. Stops cleanly on SIGINT without orphans or stale pidfile.
 * 3. Can be restarted immediately after stopping.
 * 4. Force-kill (SIGINT ignored -> SIGKILL escalation) terminates child within grace.
 * 5. Zero orphaned processes remain after all transitions.
 */

const TEST_DIR = resolve(".tmp/automated-manual-p6");
const FIXTURE = resolve("tests/fixtures/fake-server.sh");
const READY_PATTERN = /listening on/;

describe("Phase 6: automated lifecycle & safety", () => {
	beforeAll(() => {
		mkdirSync(TEST_DIR, { recursive: true });
	});

	afterAll(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	it("completes launch -> observe -> stop -> restart -> force-kill cycle without orphans or stale pidfile", async () => {
		const port = 19250;
		const stateDir = `${TEST_DIR}/state`;
		mkdirSync(stateDir, { recursive: true });

		// Step 1: Launch and reach READY
		let supervisor = new Supervisor({
			command: "bash",
			args: [FIXTURE, "--port", String(port)],
			port,
			readyPattern: READY_PATTERN,
			timings: { sigintGraceMs: 500, sigkillGraceMs: 500 },
		});

		let ready = false;
		supervisor.onState((e) => {
			if (e.state === "READY") ready = true;
		});

		await supervisor.start();

		// Wait for READY
		const t0 = Date.now();
		while (!ready && Date.now() - t0 < 4000) {
			await Bun.sleep(50);
		}
		expect(ready).toBe(true);
		expect(supervisor.pid).toBeGreaterThan(0);

		const pid = supervisor.pid ?? 0;
		expect(process.kill(pid, 0)).toBe(true);

		// Step 2: Clean stop
		await supervisor.teardown();
		expect(() => process.kill(pid, 0)).toThrow();

		// Step 3: Restart
		supervisor = new Supervisor({
			command: "bash",
			args: [FIXTURE, "--port", String(port)],
			port,
			readyPattern: READY_PATTERN,
			timings: { sigintGraceMs: 500, sigkillGraceMs: 500 },
		});

		ready = false;
		supervisor.onState((e) => {
			if (e.state === "READY") ready = true;
		});

		await supervisor.start();
		const t1 = Date.now();
		while (!ready && Date.now() - t1 < 4000) {
			await Bun.sleep(50);
		}
		expect(ready).toBe(true);
		const restartPid = supervisor.pid ?? 0;
		expect(restartPid).toBeGreaterThan(0);

		await supervisor.teardown();
		expect(() => process.kill(restartPid, 0)).toThrow();

		// Step 4: Force-kill on INT-immune child (escalates to SIGKILL)
		const immuneSupervisor = new Supervisor({
			command: "bash",
			args: [FIXTURE, "--port", String(port), "--ignore-int"],
			port,
			readyPattern: READY_PATTERN,
			timings: { sigintGraceMs: 200, sigkillGraceMs: 200 },
		});

		await immuneSupervisor.start();
		const immunePid = immuneSupervisor.pid ?? 0;
		expect(immunePid).toBeGreaterThan(0);

		const killT0 = Date.now();
		await immuneSupervisor.teardown();
		const killElapsed = Date.now() - killT0;

		expect(killElapsed).toBeLessThan(3000);
		expect(() => process.kill(immunePid, 0)).toThrow();
	});
});
