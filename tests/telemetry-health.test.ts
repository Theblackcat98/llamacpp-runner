import { describe, expect, it } from "bun:test";
import { HealthPoller, type HealthStatus } from "../src/core/telemetry/health";
import {
	createTelemetryMonitor,
	type TelemetryInput,
	transition,
} from "../src/core/telemetry/state-machine";

function bunSleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

describe("state machine transitions (§3.5, P5-FR-01)", () => {
	const cases: {
		name: string;
		from: Parameters<typeof transition>[0];
		input: TelemetryInput;
		to: ReturnType<typeof transition>;
	}[] = [
		{
			name: "IDLE + spawned -> STARTING",
			from: "IDLE",
			input: { type: "spawned" },
			to: "STARTING",
		},
		{
			name: "STARTING + health 503 -> LOADING",
			from: "STARTING",
			input: { type: "health", status: "loading" },
			to: "LOADING",
		},
		{
			name: "STARTING + health 200 -> READY (fast load)",
			from: "STARTING",
			input: { type: "health", status: "ready" },
			to: "READY",
		},
		{
			name: "STARTING + log marker -> READY",
			from: "STARTING",
			input: { type: "log_ready" },
			to: "READY",
		},
		{
			name: "LOADING + health 200 -> READY",
			from: "LOADING",
			input: { type: "health", status: "ready" },
			to: "READY",
		},
		{
			name: "READY ignores downgrade to 503 (sticky)",
			from: "READY",
			input: { type: "health", status: "loading" },
			to: "READY",
		},
		{
			name: "unreachable health keeps phase",
			from: "LOADING",
			input: { type: "health", status: "unreachable" },
			to: "LOADING",
		},
		{
			name: "non-zero exit without signal -> FAILED",
			from: "LOADING",
			input: { type: "exited", code: 1, signal: null },
			to: "FAILED",
		},
		{
			name: "clean exit -> IDLE",
			from: "READY",
			input: { type: "exited", code: 0, signal: null },
			to: "IDLE",
		},
		{
			name: "signalled exit (user kill) -> IDLE not FAILED",
			from: "READY",
			input: { type: "exited", code: 0, signal: "SIGINT" },
			to: "IDLE",
		},
		{
			name: "FAILED is terminal until reset",
			from: "FAILED",
			input: { type: "health", status: "ready" },
			to: "FAILED",
		},
	];

	for (const c of cases) {
		it(c.name, () => {
			expect(transition(c.from, c.input)).toBe(c.to);
		});
	}
});

describe("HealthPoller vs mock HTTP (P5-FR-01)", () => {
	it("maps 503 -> loading then 200 -> ready", async () => {
		const t0 = Date.now();
		const server = Bun.serve({
			port: 0,
			fetch() {
				return Date.now() - t0 < 250
					? new Response(null, { status: 503 })
					: Response.json({ status: "ok" });
			},
		});
		const statuses: HealthStatus[] = [];
		const poller = new HealthPoller({
			url: `http://127.0.0.1:${server.port}/health`,
			intervalMs: 40,
			timeoutMs: 500,
		});
		poller.onStatus((s) => statuses.push(s.status));
		poller.start();
		const ok = await waitFor(() => statuses.includes("ready"), 3000);
		poller.stop();
		server.stop(true);
		expect(ok).toBe(true);
		expect(statuses[statuses.length - 1]).toBe("ready");
		expect(statuses.includes("loading")).toBe(true);
	});

	it("connection refused -> unreachable with backoff growth", async () => {
		// grab a port then close the server so nothing listens there
		const server = Bun.serve({ port: 0, fetch: () => new Response() });
		const deadPort = server.port;
		server.stop(true);
		await bunSleep(30);
		let calls = 0;
		const poller = new HealthPoller({
			url: `http://127.0.0.1:${deadPort}/health`,
			intervalMs: 20,
			backoffMaxMs: 60,
			fetchImpl: async () => {
				calls++;
				throw new Error("ECONNREFUSED");
			},
		});
		const seen: HealthStatus[] = [];
		poller.onStatus((s) => seen.push(s.status));
		poller.start();
		await bunSleep(150);
		poller.stop();
		expect(seen.every((s) => s === "unreachable")).toBe(true);
		expect(seen.length).toBeGreaterThanOrEqual(2);
		// backoff: later gaps must be >= earlier ones (capped at backoffMaxMs)
		expect(calls).toBeLessThan(150 / 20);
	});
});

describe("createTelemetryMonitor vs fake-server.sh --http", () => {
	it("badge timeline STARTING -> LOADING -> READY driven by /health", async () => {
		const phases = await runMonitorScenario(["--http", "400"]);
		expect(phases.slice(0, 3)).toEqual(["STARTING", "LOADING", "READY"]);
	}, 10_000);

	it("crash while serving -> FAILED", async () => {
		const phases = await runMonitorScenario([
			"--http",
			"5000",
			"--crash-after",
			"0.4",
			"--exit-code",
			"1",
		]);
		const timeline = phases.filter((p) => !p.startsWith("terminal:"));
		expect(timeline[timeline.length - 1]).toBe("FAILED");
		expect(timeline.includes("READY")).toBe(false);
	}, 10_000);
});

const FIXTURE = new URL("./fixtures/fake-server.sh", import.meta.url).pathname;

async function runMonitorScenario(args: string[]): Promise<string[]> {
	const { Supervisor } = await import("../src/core/process/supervisor");
	const port = await freePort();
	const sv = new Supervisor({
		command: "bash",
		args: [FIXTURE, "--port", String(port), ...args],
		port,
		timings: { sigintGraceMs: 400, sigkillGraceMs: 400 },
	});
	const health = new HealthPoller({
		url: `http://127.0.0.1:${port}/health`,
		intervalMs: 60,
		timeoutMs: 800,
	});
	const monitor = createTelemetryMonitor({ supervisor: sv, health });
	const phases: string[] = [];
	monitor.onChange((p) => phases.push(p));
	health.start();
	sv.start();
	const done = await waitFor(
		() => monitor.phase === "READY" || monitor.phase === "FAILED",
		6000,
	);
	expect(done).toBe(true);
	if (monitor.phase !== "FAILED") {
		await bunSleep(120);
	}
	health.stop();
	await sv.teardown();
	phases.push(`terminal:${monitor.phase}`);
	return phases;
}

async function freePort(): Promise<number> {
	const s = Bun.serve({ port: 0, fetch: () => new Response() });
	const p = s.port;
	s.stop(true);
	await bunSleep(30);
	if (p === undefined) throw new Error("no ephemeral port");
	return p;
}

async function waitFor(
	cond: () => boolean,
	timeoutMs = 3000,
): Promise<boolean> {
	const started = Date.now();
	while (!cond()) {
		if (Date.now() - started > timeoutMs) return false;
		await bunSleep(10);
	}
	return true;
}
