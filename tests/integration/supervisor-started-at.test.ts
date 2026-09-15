import { describe, expect, it } from "bun:test";
import { createBus } from "../../src/core/bus";
import type { IntentMap, StateMap } from "../../src/core/bus-contract";
import { Supervisor } from "../../src/core/process/supervisor";
import { createSession } from "../../src/core/session";
import { resolvePaths } from "../../src/core/store/state-paths";

const FIXTURE = new URL("../fixtures/fake-server.sh", import.meta.url).pathname;
const FAST = { sigintGraceMs: 400, sigkillGraceMs: 400 };
const READY = /listening on/;

describe("supervisor startedAtMs and host/port getters (§6.2)", () => {
	it("exposes host and port matching options", () => {
		const sv = new Supervisor({
			command: "bash",
			args: [FIXTURE],
			port: 9999,
			host: "0.0.0.0",
		});
		expect(sv.port).toBe(9999);
		expect(sv.host).toBe("0.0.0.0");
	});

	it("captures startedAtMs when starting and clears on exit", async () => {
		const sv = new Supervisor({
			command: "bash",
			args: [FIXTURE, "--exit-after", "1"],
			port: 19991,
			readyPattern: READY,
			timings: FAST,
		});

		expect(sv.startedAtMs).toBeNull();

		const events: { state: string; startedAtMs?: number | null }[] = [];
		sv.onState((e) => {
			events.push({
				state: e.state,
				startedAtMs: (e as { startedAtMs?: number | null }).startedAtMs,
			});
		});

		const before = Date.now();
		await sv.start();
		expect(sv.startedAtMs).toBeGreaterThanOrEqual(before);
		expect(sv.startedAtMs).toBeLessThanOrEqual(Date.now());

		// Wait for exit
		await sv.kill();
		expect(sv.startedAtMs).toBeNull();

		const loadingEvent = events.find((e) => e.state === "LOADING");
		expect(loadingEvent?.startedAtMs).toBeGreaterThanOrEqual(before);
	});

	it("session forwards startedAtMs over PROC_STATE event", async () => {
		const bus = createBus<IntentMap, StateMap>();
		const port = 19992;
		const session = createSession({
			command: "bash",
			args: [FIXTURE, "--port", String(port)],
			port,
			presetId: "test-preset",
			paths: resolvePaths(),
			bus,
			supervisor: new Supervisor({
				command: "bash",
				args: [FIXTURE, "--port", String(port)],
				port,
				readyPattern: READY,
				timings: FAST,
			}),
		});

		let recordedStartedAt: number | null | undefined;
		bus.onState("PROC_STATE", (e) => {
			if (e.state === "LOADING" || e.state === "READY") {
				recordedStartedAt = e.startedAtMs;
			}
		});

		const before = Date.now();
		await session.boot();
		await session.supervisor?.start();

		// Wait for start
		let waited = 0;
		while (recordedStartedAt === undefined && waited < 2000) {
			await Bun.sleep(20);
			waited += 20;
		}

		expect(recordedStartedAt).toBeGreaterThanOrEqual(before);
		await session.shutdown();
	});

	it("orphan detection syslog uses lowercase 'press k to kill'", async () => {
		const proc = Bun.spawn(["bash", "-c", "exec -a llama-server sleep 60"], {
			stdout: "ignore",
			stderr: "ignore",
		});
		await Bun.sleep(50);

		const bus = createBus<IntentMap, StateMap>();
		const paths = resolvePaths();
		const pidfile = require("../../src/core/store/pidfile");
		pidfile.writePidFile(paths.pidFile, {
			pid: proc.pid,
			port: 19993,
			presetId: "orphan-test",
			startedAt: new Date().toISOString(),
		});

		const logs: string[] = [];
		bus.onState("LOG_LINE", (e) => logs.push(e.text));

		const session = createSession({
			paths,
			bus,
		});

		await session.boot();
		pidfile.clearPidFile(paths.pidFile);
		try {
			proc.kill();
		} catch {}

		const orphanLog = logs.find((l) => l.includes("orphaned llama-server"));
		expect(orphanLog).toBeDefined();
		expect(orphanLog).toContain("press k to kill");
		expect(orphanLog).not.toContain("press K to kill");
	});
});
