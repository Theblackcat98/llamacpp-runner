import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createBus } from "../src/core/bus";
import type { IntentMap, StateMap } from "../src/core/bus-contract";
import { checkPortFree } from "../src/core/process/supervisor";
import { createSession } from "../src/core/session";
import { resolvePaths } from "../src/core/store/state-paths";
import { SessionApp } from "../src/main";
import { renderWithAct, teardownWithAct } from "./ui/golden/harness";

const PROJECT_ROOT = join(import.meta.dir, "..");
const TMP_BASE = join(PROJECT_ROOT, ".tmp");
const FAKE_SERVER = join(PROJECT_ROOT, "tests", "fixtures", "fake-server.sh");

async function freePort(from: number): Promise<number> {
	let port = from;
	while (!(await checkPortFree(port, "127.0.0.1"))) port++;
	return port;
}

/** True when a fetch targets the telemetry endpoints of the fake server. */
function isTelemetryFetch(input: unknown): boolean {
	let url = "";
	if (typeof input === "string") url = input;
	else if (input instanceof URL) url = input.href;
	else if (input instanceof Request) url = input.url;
	return /127\.0\.0\.1:\d+\/(health|metrics|slots)/.test(url);
}

async function waitFor(
	cond: () => boolean,
	timeoutMs: number,
	label: string,
): Promise<void> {
	const start = Date.now();
	while (!cond()) {
		if (Date.now() - start > timeoutMs)
			throw new Error(`timed out waiting for ${label}`);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

/**
 * Issue #16 (RED): telemetry must follow the managed server lifecycle —
 * launch → repeated render → kill → repeated render must leave NO polling
 * running after teardown.
 */
describe("telemetry lifecycle follows server lifecycle (Issue #16)", () => {
	let scratch = "";
	const realFetch = globalThis.fetch;
	let teleFetches = 0;

	afterEach(() => {
		globalThis.fetch = realFetch;
		if (scratch) rmSync(scratch, { recursive: true, force: true });
		scratch = "";
	});

	it("stops polling after kill and rebinds cleanly on relaunch", async () => {
		mkdirSync(TMP_BASE, { recursive: true });
		scratch = mkdtempSync(join(TMP_BASE, "tele-lifecycle-"));
		mkdirSync(join(scratch, "config"), { recursive: true });
		mkdirSync(join(scratch, "state"), { recursive: true });
		const port = await freePort(18411);

		globalThis.fetch = (async (
			input: Parameters<typeof fetch>[0],
			init?: Parameters<typeof fetch>[1],
		) => {
			if (isTelemetryFetch(input)) teleFetches++;
			return realFetch(input, init);
		}) as typeof fetch;

		const bus = createBus<IntentMap, StateMap>();
		const paths = resolvePaths({
			XDG_CONFIG_HOME: join(scratch, "config"),
			XDG_STATE_HOME: join(scratch, "state"),
		});
		const session = createSession({
			paths,
			bus,
			resolveLaunch: () => ({
				command: FAKE_SERVER,
				args: ["--port", String(port), "--http", "0"],
				port,
				host: "127.0.0.1",
				presetId: "ad-hoc",
			}),
		});
		await session.boot();

		const setup = await renderWithAct(
			<SessionApp bus={bus} paths={paths} session={session} />,
			{ width: 120, height: 30 },
		);

		async function rerenderRepeatedly(): Promise<void> {
			await act(async () => {
				for (let i = 0; i < 3; i++) {
					bus.emitState("LOG_LINE", { stream: "out", text: `tick ${i}` });
					await new Promise((resolve) => setTimeout(resolve, 50));
				}
				await setup.flush();
			});
		}

		try {
			// Launch: all three pollers must tick at least once.
			await act(async () => {
				bus.emitIntent("LAUNCH", { presetId: "ad-hoc" });
			});
			await waitFor(() => teleFetches >= 3, 20_000, "telemetry polling");
			await rerenderRepeatedly();

			// Kill + repeated renders: polling must stop promptly.
			await act(async () => {
				bus.emitIntent("KILL", {});
			});
			await waitFor(
				() => session.supervisor === null || !session.supervisor.isRunning,
				10_000,
				"server teardown",
			);
			await rerenderRepeatedly();
			const frozenAfterKill = teleFetches;
			await new Promise((resolve) => setTimeout(resolve, 6500));
			expect(teleFetches).toBe(frozenAfterKill);

			// Relaunch on a fresh instance: polling must resume (clean rebind).
			await act(async () => {
				bus.emitIntent("LAUNCH", { presetId: "ad-hoc" });
			});
			await waitFor(
				() => teleFetches > frozenAfterKill,
				20_000,
				"telemetry polling after relaunch",
			);
			await rerenderRepeatedly();

			// Final kill: nothing from either generation may keep polling.
			await act(async () => {
				bus.emitIntent("KILL", {});
			});
			await waitFor(
				() => session.supervisor === null || !session.supervisor.isRunning,
				10_000,
				"second server teardown",
			);
			await rerenderRepeatedly();
			const frozenFinal = teleFetches;
			await new Promise((resolve) => setTimeout(resolve, 6500));
			expect(teleFetches).toBe(frozenFinal);
		} finally {
			await session.shutdown();
			await teardownWithAct(setup);
		}
	}, 60_000);
});
