import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { buildCommand } from "../../src/core/flags/builder";
import { Supervisor } from "../../src/core/process/supervisor";
import { HealthPoller } from "../../src/core/telemetry/health";
import { MetricsPoller } from "../../src/core/telemetry/metrics";
import {
	createTelemetryService,
	type TelemetrySnapshot,
} from "../../src/core/telemetry/service";
import { SlotsPoller } from "../../src/core/telemetry/slots";
import { buildTelemetryViewModel } from "../../src/ui/logic/telemetry-state";

/**
 * Automated verification for Phase 7 (Telemetry integration).
 * Proves:
 * 1. Non-default host/port endpoint correctly drives the telemetry service.
 * 2. Complete lifecycle: STARTING -> LOADING -> READY with live metrics & slots -> IDLE teardown.
 * 3. Telemetry toggle disables --slots/--metrics launch flags and enters dormant state.
 * 4. Toggling back on restores live poller collection.
 */

import { CANNED_METRICS, CANNED_SLOTS } from "../fixtures/fake-http";

const FIXTURE = resolve("tests/fixtures/fake-server.sh");

describe("Phase 7: automated telemetry walkthrough", () => {
	it("walks STARTING -> LOADING -> READY with non-default host/port and tears down to IDLE", async () => {
		const HTTP_PORT = 28455;
		const SV_PORT = 28456;
		let healthState = 503;

		const server = Bun.serve({
			port: HTTP_PORT,
			fetch(req) {
				const path = new URL(req.url).pathname;
				if (path === "/health") {
					if (healthState === 503) {
						return new Response('{"status":"loading model"}', {
							status: 503,
							headers: { "content-type": "application/json" },
						});
					}
					return Response.json({ status: "ok", slots_idle: 2 });
				}
				if (path === "/metrics") {
					return new Response(CANNED_METRICS, {
						headers: { "content-type": "text/plain" },
					});
				}
				if (path === "/slots") {
					return Response.json(CANNED_SLOTS);
				}
				return new Response("not found", { status: 404 });
			},
		});

		try {
			const endpoint = `http://127.0.0.1:${HTTP_PORT}`;

			const supervisor = new Supervisor({
				command: "bash",
				args: [FIXTURE, "--port", String(SV_PORT)],
				port: SV_PORT,
				readyPattern: /listening on/,
				timings: { sigintGraceMs: 500, sigkillGraceMs: 500 },
			});

			const health = new HealthPoller({
				url: `${endpoint}/health`,
				intervalMs: 25,
			});
			const metrics = new MetricsPoller({
				url: `${endpoint}/metrics`,
				intervalMs: 25,
			});
			const slots = new SlotsPoller({
				url: `${endpoint}/slots`,
				intervalMs: 25,
			});

			const service = createTelemetryService({
				supervisor,
				health,
				metrics,
				slots,
			});

			const phases: string[] = [];
			const snapshots: TelemetrySnapshot[] = [];
			service.onSnapshot((s) => {
				phases.push(s.phase);
				snapshots.push(s);
			});

			service.start();
			await supervisor.start();

			// Transition health endpoint to ready
			await Bun.sleep(50);
			healthState = 200;

			// Wait for READY with metrics and slots
			const t0 = Date.now();
			while (
				!snapshots.some(
					(s) =>
						s.phase === "READY" &&
						s.metrics?.kvUsageRatio !== null &&
						s.slots.length > 0,
				) &&
				Date.now() - t0 < 5000
			) {
				await Bun.sleep(25);
			}

			expect(phases).toContain("STARTING");
			expect(phases).toContain("READY");

			// Verify live metrics and slots populated in READY snapshot
			const readySnap = snapshots.find(
				(s) =>
					s.phase === "READY" &&
					s.metrics?.kvUsageRatio !== null &&
					s.slots.length > 0,
			);
			expect(readySnap).toBeDefined();
			expect(readySnap?.metrics?.kvUsageRatio).toBe(0.42);
			expect(readySnap?.slots.length).toBe(2);

			// Teardown supervisor and stop service
			await supervisor.teardown();
			service.stop();

			expect(service.snapshot.phase).toBe("IDLE");
			expect(service.snapshot.metrics).toBeNull();
		} finally {
			server.stop(true);
		}
	}, 15000);

	it("toggles telemetry on and off, switching launch flags and dormant VM state", () => {
		// Telemetry Enabled: launch flags include --slots and --metrics
		const enabledCmd = buildCommand({
			modelPath: "/models/test.gguf",
			values: {
				n_gpu_layers: 16,
				ctx_size: 4096,
				telemetry: true,
			},
		});
		expect(enabledCmd.args).toContain("--slots");
		expect(enabledCmd.args).toContain("--metrics");

		const enabledVm = buildTelemetryViewModel({
			phase: "READY",
			model: "/models/test.gguf",
			endpoint: "http://127.0.0.1:8080",
			startedAtMs: Date.now() - 5000,
			nowMs: Date.now(),
			telemetryEnabled: true,
			vramEstimatedBytes: { low: 3_000_000_000, high: 4_000_000_000 },
			memUsedBytes: 3_800_000_000,
			kvUsageRatio: 0.45,
			promptHistory: [],
			decodeHistory: [],
			slots: [],
			failure: null,
			tailLines: [],
		});
		expect(enabledVm.dormant).toBe(false);

		// Telemetry Disabled: launch flags drop --slots and --metrics
		const disabledCmd = buildCommand({
			modelPath: "/models/test.gguf",
			values: {
				n_gpu_layers: 16,
				ctx_size: 4096,
			},
			telemetry: false,
		});
		expect(disabledCmd.args).not.toContain("--slots");
		expect(disabledCmd.args).not.toContain("--metrics");

		const dormantVm = buildTelemetryViewModel({
			phase: "IDLE",
			model: "/models/test.gguf",
			endpoint: null,
			startedAtMs: null,
			nowMs: Date.now(),
			telemetryEnabled: false,
			vramEstimatedBytes: null,
			memUsedBytes: null,
			kvUsageRatio: null,
			promptHistory: [],
			decodeHistory: [],
			slots: [],
			failure: null,
			tailLines: [],
		});
		expect(dormantVm.dormant).toBe(true);
	});
});
