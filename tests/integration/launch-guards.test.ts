import { describe, expect, it } from "bun:test";
import * as net from "node:net";
import { resolve } from "node:path";
import { createBus } from "../../src/core/bus";
import type { IntentMap, StateMap } from "../../src/core/bus-contract";
import { createSession } from "../../src/core/session";
import { resolvePaths } from "../../src/core/store/state-paths";

const FIXTURE = resolve(import.meta.dir, "../fixtures/fake-server.sh");

interface Harness {
	bus: ReturnType<typeof createBus<IntentMap, StateMap>>;
	spawnedPorts: number[];
	setPlan(next: { port?: number; host?: string }): void;
}

function makeSession(
	plan: { port: number; host?: string } = { port: 18100, host: "127.0.0.1" },
): Harness {
	const bus = createBus<IntentMap, StateMap>();
	const spawnedPorts: number[] = [];
	let current = { ...plan };
	createSession({
		paths: resolvePaths(),
		bus,
		resolveLaunch: () => ({
			command: "bash",
			args: [FIXTURE, "--port", String(current.port)],
			port: current.port,
			presetId: "guard-test",
			host: current.host,
			timings: { sigintGraceMs: 400, sigkillGraceMs: 400 },
			onSpawn: (p) => spawnedPorts.push(p),
		}),
	});
	return {
		bus,
		spawnedPorts,
		setPlan(next: { port?: number; host?: string }) {
			current = { ...current, ...next };
		},
	};
}

/** P4-FR-09/10/20: launch pipeline guards. */
describe("launch guards", () => {
	it("0.0.0.0 without confirmation emits CONFIRM_REQUIRED and never spawns (P4-FR-09)", async () => {
		const h = makeSession({ port: 18110, host: "0.0.0.0" });
		let confirmed = false;
		h.bus.onState("CONFIRM_REQUIRED", () => {
			confirmed = true;
		});
		await h.bus.emitIntent("LAUNCH", { presetId: "guard-test" });
		await Bun.sleep(100);
		expect(confirmed).toBe(true);
		expect(h.spawnedPorts.length).toBe(0);
	}, 5000);

	it("port conflict emits PORT_CONFLICT with a suggested next free port (P4-FR-10)", async () => {
		const blocker = net.createServer();
		await new Promise<void>((r) => blocker.listen(18120, "127.0.0.1", r));
		try {
			const h = makeSession({ port: 18120 });
			let suggested: number | undefined;
			h.bus.onState("PORT_CONFLICT", (e) => {
				suggested = e.suggested;
			});
			h.setPlan({ port: 18120 });
			await h.bus.emitIntent("LAUNCH", { presetId: "guard-test" });
			await Bun.sleep(200);
			expect(suggested).toBeDefined();
			expect(suggested).toBeGreaterThan(18120);
			expect(h.spawnedPorts.length).toBe(0);
		} finally {
			await new Promise<void>((r) => blocker.close(() => r()));
		}
	}, 8000);

	it("second LAUNCH while running is blocked — exactly one managed instance (P4-FR-20, D4)", async () => {
		const h = makeSession({ port: 18130 });
		let blockedReason: string | undefined;
		h.bus.onState("LAUNCH_BLOCKED", (e) => {
			blockedReason = e.reason;
		});
		await h.bus.emitIntent("LAUNCH", { presetId: "guard-test" });
		await Bun.sleep(150);
		expect(h.spawnedPorts.length).toBe(1);

		await h.bus.emitIntent("LAUNCH", { presetId: "guard-test" });
		await Bun.sleep(150);
		expect(blockedReason).toBe("instance_running");
		expect(h.spawnedPorts.length).toBe(1);

		// teardown for the one running child
		await h.bus.emitIntent("KILL", {});
		await Bun.sleep(600);
	}, 10000);
});
