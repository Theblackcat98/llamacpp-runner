import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { runQuickSupervisor } from "../../src/core/quick";
import type { LaunchPlan } from "../../src/core/session";
import { readPidFile } from "../../src/core/store/pidfile";

const FIXTURE = resolve(import.meta.dir, "../fixtures/fake-server.sh");
const TMP = resolve(import.meta.dir, "../.tmp/quick-pidfile");

afterAll(() => {
	rmSync(TMP, { recursive: true, force: true });
});

/**
 * #61: CLI-started servers must write pidfile records WITH presetId —
 * orphan records otherwise lose preset attribution (the TUI path has it).
 */
describe("runQuickSupervisor pidfile record (#61)", () => {
	it("records presetId alongside pid and port", async () => {
		mkdirSync(TMP, { recursive: true });
		const pidFile = join(TMP, "server.pid");
		const port = 18112;
		const plan: LaunchPlan = {
			command: "bash",
			args: [FIXTURE, "--port", String(port)],
			port,
			presetId: "quick",
		};

		const done = runQuickSupervisor(plan, { pidFile });

		// Wait for the LOADING-driven record, then verify its shape.
		let record = null;
		const started = Date.now();
		while (Date.now() - started < 8000) {
			record = readPidFile(pidFile);
			if (record) break;
			await Bun.sleep(20);
		}
		expect(record).not.toBeNull();
		expect(record?.presetId).toBe("quick");
		expect(record?.port).toBe(port);
		expect(record?.pid).toBeNumber();

		// Stop the server; the run resolves and the pidfile is cleared.
		// (An externally signaled child may surface as -1 — irrelevant to
		// the record shape under test.)
		if (record) process.kill(record.pid, "SIGTERM");
		await done;
		expect(existsSync(pidFile)).toBe(false);
	}, 20000);
});
