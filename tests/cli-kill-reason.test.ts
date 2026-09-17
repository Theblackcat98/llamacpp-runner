import { describe, expect, it } from "bun:test";
import { killOutcome } from "../src/cli";

/**
 * #61: `llama-deck kill` must report the `unknown` inspection status
 * distinctly — macOS / permission-failed identity checks mean a server may
 * well be running, and "no server running" is a lie there.
 */
describe("kill outcome mapping (#61)", () => {
	it("unknown status is honest, distinct, and non-zero", () => {
		const out = killOutcome("unknown", false);
		expect(out.reason).toBe("unknown");
		expect(out.exitCode).toBe(1);
		expect(out.message).toContain("identity unavailable");
		expect(out.message).not.toContain("no server running");
	});

	it("alive kill success and failure keep their messages", () => {
		expect(killOutcome("alive", true, 4242)).toEqual({
			reason: "alive",
			message: "killed llama-server pid=4242",
			exitCode: 0,
		});
		const failed = killOutcome("alive", false, 4242);
		expect(failed.exitCode).toBe(1);
		expect(failed.message).toBe("failed to kill");
	});

	it("stale and no_pidfile stay non-zero-free no-ops", () => {
		expect(killOutcome("stale", false)).toEqual({
			reason: "stale",
			message: "stale pidfile cleaned — no server running",
			exitCode: 0,
		});
		expect(killOutcome("none", false)).toEqual({
			reason: "no_pidfile",
			message: "no server running",
			exitCode: 0,
		});
	});
});
