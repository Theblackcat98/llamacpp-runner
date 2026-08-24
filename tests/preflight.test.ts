import { describe, expect, it } from "bun:test";
import { createServer } from "node:http";
import * as net from "node:net";
import {
	findNextFreePort,
	requiresHostConfirmation,
} from "../src/core/process/preflight";

describe("port pre-flight (P4-FR-10, §7)", () => {
	it("reports the requested port when free", async () => {
		const result = await findNextFreePort(0);
		expect(result.free).toBe(true);
	});

	it("suggests the next free port on conflict", async () => {
		const blocker = net.createServer();
		await new Promise<void>((resolve) =>
			blocker.listen(0, "127.0.0.1", resolve),
		);
		const addr = blocker.address() as net.AddressInfo;

		const result = await findNextFreePort(addr.port);
		expect(result.free).toBe(false);
		expect(result.suggested).toBeGreaterThan(addr.port);

		await new Promise<void>((resolve) => blocker.close(() => resolve()));
	});
});

/** P4-FR-09: 0.0.0.0 triggers a confirm gate before any launch. */
describe("host confirmation gate (P4-FR-09)", () => {
	it("127.0.0.1 launches directly", () => {
		expect(requiresHostConfirmation("127.0.0.1")).toBe(false);
		expect(requiresHostConfirmation(undefined)).toBe(false);
	});

	it("0.0.0.0 requires explicit confirmation", () => {
		expect(requiresHostConfirmation("0.0.0.0")).toBe(true);
	});
});

// Keep http import referenced for potential future use in mock servers.
void createServer;
