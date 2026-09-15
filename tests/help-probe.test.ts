import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { captureHelp } from "../src/core/flags/validate";

const STDERR_ONLY = join(import.meta.dir, "fixtures/help/stderr-only-help.sh");
const MIXED = join(import.meta.dir, "fixtures/help/mixed-help.sh");
const HANG = join(import.meta.dir, "fixtures/help/hang-help.sh");

/**
 * Issue #19 (RED): --help probe hardening.
 * - stderr-only / mixed-stream help must be captured (currently stdout only);
 * - PATH-resolved binaries must be probed at the resolved path;
 * - probe failure must be explicit (verified=false), never false-validated;
 * - probe timeout must be injectable and kill the child quickly.
 */
describe("issue #19: --help probe hardening", () => {
	it("captures help emitted on stderr only", async () => {
		const text = await captureHelp(STDERR_ONLY);
		expect(text).toContain("--ctx-size N");
	}, 10_000);

	it("captures help split across stdout and stderr", async () => {
		const text = await captureHelp(MIXED);
		expect(text).toContain("--ctx-size N");
		expect(text).toContain("--mlock");
	}, 10_000);

	it("PATH-resolved binary is probed at its resolved path", async () => {
		const mod = (await import(
			"../src/core/flags/validate"
		)) as unknown as Record<string, unknown>;
		expect(typeof mod.probeBinaryAvailability).toBe("function");
		const probe = mod.probeBinaryAvailability as (opts: {
			configured?: string;
			whichFn?: (command: string) => string | null;
		}) => Promise<{
			verified: boolean;
			availability: Record<string, { supported: boolean }>;
		}>;
		const result = await probe({
			configured: undefined,
			whichFn: () => STDERR_ONLY,
		});
		expect(result.verified).toBe(true);
		expect(result.availability.ctx_size?.supported).toBe(true);
	}, 10_000);

	it("probe failure is explicit, never false-validated", async () => {
		const mod = (await import(
			"../src/core/flags/validate"
		)) as unknown as Record<string, unknown>;
		const probe = mod.probeBinaryAvailability as (opts: {
			configured?: string;
			whichFn?: (command: string) => string | null;
		}) => Promise<{
			verified: boolean;
			availability: Record<string, unknown>;
		}>;
		const result = await probe({
			configured: "/no/such/binary",
			whichFn: () => null,
		});
		expect(result.verified).toBe(false);
		expect(result.availability).toEqual({});
	}, 10_000);

	it("probe timeout is injectable and kills the hanging child", async () => {
		const mod = (await import(
			"../src/core/flags/validate"
		)) as unknown as Record<string, unknown>;
		const cap = (
			typeof mod.captureHelpWithTimeout === "function"
				? mod.captureHelpWithTimeout
				: captureHelp
		) as (cmd: string, opts?: { timeoutMs: number }) => Promise<string>;
		const start = Date.now();
		const text = await cap(HANG, { timeoutMs: 300 });
		const elapsed = Date.now() - start;
		expect(text).toBe("");
		expect(elapsed).toBeLessThan(4000);
	}, 10_000);
});
