import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { createBus } from "../../src/core/bus";
import type { StateMap } from "../../src/core/bus-contract";
import { createSession } from "../../src/core/session";

const FIXTURE = new URL("../fixtures/fake-server.sh", import.meta.url).pathname;
const TMP = new URL("../.tmp/session-failure/", import.meta.url).pathname;

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

describe("failure classification over the bus (P5-FR-07)", () => {
	it("crashing server emits FAILURE_CLASSIFIED with vram_oom + fix", async () => {
		const bus = createBus<
			import("../../src/core/bus-contract").IntentMap,
			StateMap
		>();
		const classified: StateMap["FAILURE_CLASSIFIED"][] = [];
		bus.onState("FAILURE_CLASSIFIED", (e) => classified.push(e));
		const session = createSession({
			paths: tmpPaths("oom"),
			bus,
			command: "bash",
			args: [FIXTURE, "--crash-after", "0.3", "--exit-code", "1"],
			port: 19001,
		});
		await session.boot();
		void session.supervisor.start();
		await new Promise((r) => setTimeout(r, 1200));
		expect(classified.length).toBeGreaterThanOrEqual(1);
		expect(classified[0]?.kind).toBe("vram_oom");
		expect(classified[0]?.suggestion).toMatch(/ngl/i);
		await session.shutdown();
	});

	it("missing binary emits FAILURE_CLASSIFIED with binary_not_found + fix (F6)", async () => {
		const bus = createBus<
			import("../../src/core/bus-contract").IntentMap,
			StateMap
		>();
		const classified: StateMap["FAILURE_CLASSIFIED"][] = [];
		bus.onState("FAILURE_CLASSIFIED", (e) => classified.push(e));
		const session = createSession({
			paths: tmpPaths("nobin"),
			bus,
			command: "definitely-not-a-llama-binary-xyz",
			args: [],
			port: 19002,
		});
		await session.boot();
		void session.supervisor.start();
		await new Promise((r) => setTimeout(r, 500));
		expect(classified.length).toBeGreaterThanOrEqual(1);
		expect(classified[0]?.kind).toBe("binary_not_found");
		expect(classified[0]?.suggestion).toMatch(/PATH|binary/i);
		await session.shutdown();
	});

	it("occupied port emits FAILURE_CLASSIFIED with port_in_use + fix (F6)", async () => {
		const holder = createServer();
		await new Promise<void>((resolve) =>
			holder.listen(19003, "127.0.0.1", () => resolve()),
		);
		try {
			const bus = createBus<
				import("../../src/core/bus-contract").IntentMap,
				StateMap
			>();
			const classified: StateMap["FAILURE_CLASSIFIED"][] = [];
			bus.onState("FAILURE_CLASSIFIED", (e) => classified.push(e));
			const session = createSession({
				paths: tmpPaths("portinuse"),
				bus,
				command: "bash",
				args: [FIXTURE, "--crash-after", "0.3", "--exit-code", "1"],
				port: 19003,
			});
			await session.boot();
			void session.supervisor.start();
			await new Promise((r) => setTimeout(r, 500));
			expect(classified.length).toBeGreaterThanOrEqual(1);
			expect(classified[0]?.kind).toBe("port_in_use");
			expect(classified[0]?.suggestion).toMatch(/port/i);
			await session.shutdown();
		} finally {
			holder.close();
		}
	});
});
