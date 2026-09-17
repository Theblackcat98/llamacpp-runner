import { describe, expect, it } from "bun:test";
import type { ProcState } from "../../src/core/bus-contract";
import { headerStatus, serverIsRunning } from "../../src/ui/logic/proc-status";

const STATES: ProcState[] = ["IDLE", "STARTING", "LOADING", "READY", "FAILED"];

describe("proc status classification (#56)", () => {
	it("serverIsRunning is true only for STARTING | LOADING | READY", () => {
		expect(serverIsRunning("STARTING")).toBe(true);
		expect(serverIsRunning("LOADING")).toBe(true);
		expect(serverIsRunning("READY")).toBe(true);
		expect(serverIsRunning("IDLE")).toBe(false);
		// FAILED is terminal — the supervisor is dead, nothing is running.
		expect(serverIsRunning("FAILED")).toBe(false);
	});

	it("FAILED renders an error-toned label, never 'server running'", () => {
		const status = headerStatus(false, true);
		expect(status.label).toBe("server failed");
		expect(status.tone).toBe("error");
		expect(status.label).not.toContain("running");
	});

	it("live states render success tone, IDLE muted", () => {
		expect(headerStatus(true, false)).toEqual({
			label: "server running",
			tone: "success",
		});
		expect(headerStatus(false, false)).toEqual({
			label: "idle",
			tone: "muted",
		});
		// FAILED wins over a stale running flag.
		expect(headerStatus(true, true).tone).toBe("error");
	});

	it("every ProcState classifies without ambiguity", () => {
		for (const state of STATES) {
			const running = serverIsRunning(state);
			const failed = state === "FAILED";
			const status = headerStatus(running, failed);
			if (failed) expect(status.tone).toBe("error");
			else if (running) expect(status.tone).toBe("success");
			else expect(status.tone).toBe("muted");
		}
	});
});
