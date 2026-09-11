import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { createBus } from "../../src/core/bus";
import type { IntentMap, StateMap } from "../../src/core/bus-contract";
import { createSession } from "../../src/core/session";

const FIXTURE = new URL("../fixtures/fake-server.sh", import.meta.url).pathname;
const TMP = new URL("../.tmp/session-boot/", import.meta.url).pathname;

function tmpPaths(tag: string) {
	const stateDir = `${TMP}${tag}/state`;
	const configDir = `${TMP}${tag}/config`;
	mkdirSync(stateDir, { recursive: true });
	mkdirSync(configDir, { recursive: true });
	return {
		stateDir,
		configDir,
		pidFile: `${stateDir}/server.pid`,
	};
}

afterAll(() => {
	rmSync(TMP, { recursive: true, force: true });
});

describe("session boot without a static launch (main.tsx resolveLaunch path)", () => {
	it("supervisor is null — not throwing — before the first launch", async () => {
		const bus = createBus<IntentMap, StateMap>();
		const session = createSession({
			paths: tmpPaths("prelaunch"),
			bus,
			resolveLaunch: () => null,
		});
		await session.boot();

		let threw = false;
		let sup = null;
		try {
			sup = session.supervisor;
		} catch {
			threw = true;
		}
		expect(threw).toBe(false);
		expect(sup).toBeNull();

		await session.shutdown();
	});

	it("supervisor becomes available after LAUNCH resolves a plan", async () => {
		const port = 18331;
		const bus = createBus<IntentMap, StateMap>();
		const session = createSession({
			paths: tmpPaths("postlaunch"),
			bus,
			resolveLaunch: () => ({
				command: "bash",
				args: [FIXTURE, "--port", String(port)],
				port,
				presetId: "boot-preset",
			}),
		});
		await session.boot();
		expect(session.supervisor).toBeNull();

		bus.emitIntent("LAUNCH", { presetId: "boot-preset" });
		const t0 = Date.now();
		while (session.supervisor === null && Date.now() - t0 < 5000) {
			await Bun.sleep(10);
		}
		const sup = session.supervisor;
		if (!sup) throw new Error("expected supervisor after LAUNCH");
		const t1 = Date.now();
		while (!sup.isRunning && sup.pid === undefined && Date.now() - t1 < 5000) {
			await Bun.sleep(10);
		}
		expect(sup.isRunning || sup.pid !== undefined).toBe(true);

		await session.shutdown();
	}, 15000);
});
