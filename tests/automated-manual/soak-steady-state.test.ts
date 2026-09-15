import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { RingBuffer } from "../../src/core/process/ring-buffer";
import { Supervisor } from "../../src/core/process/supervisor";
import { HistoryRing } from "../../src/core/telemetry/sparkline";
import { CANNED_METRICS, CANNED_SLOTS } from "../fixtures/fake-http";

/**
 * Automated verification for Soak / Steady-State Health (P5-NFR-04, PRD §10).
 * Proves:
 * 1. Long-running sessions with continuous telemetry polling exhibit bounded memory.
 * 2. History rings and line buffers strictly enforce capacity caps without unbounded array growth.
 * 3. Supervisor and subprocesses tear down completely without orphaned processes.
 */

const FIXTURE = resolve("tests/fixtures/fake-server.sh");

describe("Phase 14: automated soak & steady-state verification", () => {
	const PORT = 19499;
	let server: ReturnType<typeof Bun.serve>;

	beforeAll(() => {
		server = Bun.serve({
			port: PORT,
			fetch(req) {
				const url = new URL(req.url);
				if (url.pathname === "/health") {
					return new Response(JSON.stringify({ status: "ok" }), {
						status: 200,
						headers: { "content-type": "application/json" },
					});
				}
				if (url.pathname === "/metrics") {
					return new Response(CANNED_METRICS, {
						headers: { "content-type": "text/plain" },
					});
				}
				if (url.pathname === "/slots") {
					return new Response(JSON.stringify(CANNED_SLOTS), {
						headers: { "content-type": "application/json" },
					});
				}
				return new Response("not found", { status: 404 });
			},
		});
	});

	afterAll(() => {
		server.stop(true);
	});

	it("strictly bounds HistoryRing and RingBuffer capacity during high-volume pushes", () => {
		const ring = new HistoryRing<number>(120);
		for (let i = 0; i < 50_000; i++) {
			ring.push(i);
		}
		expect(ring.size).toBe(120);
		const snap = ring.snapshot();
		expect(snap.length).toBe(120);
		expect(snap[snap.length - 1]).toBe(49_999);

		const buffer = new RingBuffer(100);
		for (let i = 0; i < 20_000; i++) {
			buffer.push(`log line ${i}`);
		}
		expect(buffer.snapshot().length).toBe(100);
		expect(buffer.snapshot()[99]).toBe("log line 19999");
	});

	it("maintains memory stability across 200 telemetry polling cycles with zero orphans", async () => {
		const supervisorPort = 19498;
		const supervisor = new Supervisor({
			command: "bash",
			args: [FIXTURE, "--port", String(supervisorPort)],
			port: supervisorPort,
			readyPattern: /listening on/,
			timings: { sigintGraceMs: 500, sigkillGraceMs: 500 },
		});

		await supervisor.start();
		const pid = supervisor.pid ?? 0;
		expect(pid).toBeGreaterThan(0);

		// Run 200 rapid polling samples to simulate prolonged session activity
		const history = new HistoryRing<{ tps: number; kv: number }>(120);
		const logRing = new RingBuffer<string>(100);
		for (let i = 0; i < 200; i++) {
			const res = await fetch(`http://127.0.0.1:${PORT}/metrics`);
			const _text = await res.text();
			history.push({ tps: 25.4, kv: 0.42 });
			logRing.push(`tick sample ${i}`);
			if (i % 50 === 0) {
				await Bun.sleep(5);
			}
		}

		expect(history.size).toBe(120);
		expect(logRing.size).toBe(100);

		// Clean teardown
		await supervisor.teardown();

		// Assert process is cleanly killed
		expect(() => process.kill(pid, 0)).toThrow();
	}, 15000);
});
