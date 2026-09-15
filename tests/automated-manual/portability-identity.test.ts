import { describe, expect, it } from "bun:test";
import {
	isLlamaServerCommand,
	ProcProcessInspector,
	UnsupportedProcessInspector,
} from "../../src/core/process/identity";
import { requiresHostConfirmation } from "../../src/core/process/preflight";

/**
 * Automated verification for Phase 10 (Portability & Process Identity).
 * Proves:
 * 1. Linux /proc inspection extracts command lines and start identity.
 * 2. Unsupported-platform inspector degrades gracefully to "unknown" without throwing or false-killing.
 * 3. Command identification detects llama-server binaries while refusing arbitrary processes (PID reuse defense).
 * 4. Network exposure checks detect wildcard interfaces (0.0.0.0, ::) while treating loopback (127.0.0.1, ::1) safely.
 */

describe("Phase 10: automated portability & process identity", () => {
	it("probes current Linux process through /proc inspector", () => {
		const inspector = new ProcProcessInspector();
		const myPid = process.pid;

		const identity = inspector.inspect(myPid);
		expect(typeof identity).toBe("object");
		if (typeof identity === "object") {
			expect(identity.pid).toBe(myPid);
			expect(identity.command).toBeDefined();
			expect(identity.command?.length).toBeGreaterThan(0);
		}

		// Dead PID returns "dead"
		const deadStatus = inspector.inspect(999999);
		expect(deadStatus).toBe("dead");
	});

	it("handles unsupported platforms safely without throwing or false-killing", () => {
		const unsupported = new UnsupportedProcessInspector();
		expect(unsupported.inspect(process.pid)).toBe("unknown");
		expect(unsupported.canSignal(process.pid)).toBe(false);
	});

	it("guards against PID reuse by verifying command identity before signaling", () => {
		// Matching llama-server commands
		expect(isLlamaServerCommand(["llama-server", "-m", "model.gguf"])).toBe(
			true,
		);
		expect(
			isLlamaServerCommand(["/usr/local/bin/llama-server", "-m", "model.gguf"]),
		).toBe(true);

		// Non-matching recycled processes (bash, chrome, systemd, bun)
		expect(isLlamaServerCommand(["bun", "run", "test"])).toBe(false);
		expect(isLlamaServerCommand(["bash", "-c", "echo hello"])).toBe(false);
		expect(isLlamaServerCommand(["python3", "server.py"])).toBe(false);
		expect(isLlamaServerCommand(undefined)).toBe(false);
	});

	it("classifies host exposure correctly for IPv4, IPv6, and loopback", () => {
		// Wildcard bindings require exposure confirmation
		expect(requiresHostConfirmation("0.0.0.0")).toBe(true);
		expect(requiresHostConfirmation("::")).toBe(true);
		expect(requiresHostConfirmation("[::]")).toBe(true);
		expect(requiresHostConfirmation("::0")).toBe(true);

		// Loopback bindings are safe
		expect(requiresHostConfirmation("127.0.0.1")).toBe(false);
		expect(requiresHostConfirmation("localhost")).toBe(false);
		expect(requiresHostConfirmation("::1")).toBe(false);
	});
});
