import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createBus } from "../../src/core/bus";
import type { IntentMap, StateMap } from "../../src/core/bus-contract";
import { createSession } from "../../src/core/session";

const FIXTURE = resolve(import.meta.dir, "../fixtures/fake-server.sh");
const TMP = resolve(import.meta.dir, "../.tmp/session-boot");

function tmpPaths(tag: string) {
	const stateDir = join(TMP, `${tag}/state`);
	const configDir = join(TMP, `${tag}/config`);
	mkdirSync(stateDir, { recursive: true });
	mkdirSync(configDir, { recursive: true });
	return {
		stateDir,
		configDir,
		pidFile: join(stateDir, "server.pid"),
	};
}

afterAll(() => {
	rmSync(TMP, { recursive: true, force: true });
});

describe("boot binary log decision (#57)", () => {
	it("logs nothing about the binary when none is resolvable (TUI boot)", async () => {
		const bus = createBus<IntentMap, StateMap>();
		const lines: string[] = [];
		bus.onState("LOG_LINE", (e) => lines.push(e.text));
		const session = createSession({
			paths: tmpPaths("bin-silent"),
			bus,
			resolveLaunch: () => null,
		});
		await session.boot();
		// The SessionApp probe effect owns availability reporting — a boot
		// that cannot know the binary must stay silent, not warn falsely.
		expect(lines.some((l) => l.includes("not found on PATH"))).toBe(false);
		expect(lines.some((l) => l.includes("binary ok"))).toBe(false);
		await session.shutdown();
	});

	it("still warns when a CONFIGURED command is genuinely missing", async () => {
		const bus = createBus<IntentMap, StateMap>();
		const lines: string[] = [];
		bus.onState("LOG_LINE", (e) => lines.push(e.text));
		const session = createSession({
			paths: tmpPaths("bin-warn"),
			bus,
			command: "definitely-not-a-real-binary-xyz",
		});
		await session.boot();
		expect(
			lines.some((l) =>
				l.includes("definitely-not-a-real-binary-xyz not found on PATH"),
			),
		).toBe(true);
		await session.shutdown();
	});

	it("logs binary ok when the configured command resolves", async () => {
		const bus = createBus<IntentMap, StateMap>();
		const lines: string[] = [];
		bus.onState("LOG_LINE", (e) => lines.push(e.text));
		const session = createSession({
			paths: tmpPaths("bin-ok"),
			bus,
			command: "bash",
		});
		await session.boot();
		expect(lines.some((l) => l.startsWith("[SYS] binary ok: bash"))).toBe(true);
		await session.shutdown();
	});
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
