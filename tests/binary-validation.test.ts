import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { registryAvailability } from "../src/core/flags/help-parser";
import {
	type BinaryStatus,
	captureHelp,
	probeBinaryAvailability,
	resolveBinaryPath,
} from "../src/core/flags/validate";

const DUMMY = join(import.meta.dir, "fixtures/help/dummy-help.sh");

/** P4-FR-05: "not on PATH" -> prompt for path, persisted elsewhere. */
describe("resolveBinaryPath", () => {
	it("explicit existing path wins", () => {
		const result: BinaryStatus = resolveBinaryPath({
			configured: DUMMY,
			whichFn: () => null,
		});
		expect(result.status).toBe("ok");
	});

	it("bare name resolved via which()", () => {
		const result = resolveBinaryPath({
			whichFn: () => "/usr/bin/llama-server",
		});
		expect(result.status).toBe("ok");
		if (result.status === "ok")
			expect(result.path).toBe("/usr/bin/llama-server");
	});

	it("nothing found -> missing (registry idles)", () => {
		const result = resolveBinaryPath({
			configured: "/no/such/binary",
			whichFn: () => null,
		});
		expect(result.status).toBe("missing");
	});
});

describe("probeBinaryAvailability", () => {
	it("probes the binary returned by PATH resolution", async () => {
		const result = await probeBinaryAvailability({
			whichFn: () => DUMMY,
		});
		expect(result.resolvedPath).toBe(DUMMY);
		expect(result.verified).toBe(true);
		expect(result.availability.ctx_size?.supported).toBe(true);
		expect(result.availability.n_gpu_layers?.supported).toBe(false);
	}, 10_000);
});

describe("captureHelp", () => {
	it("captures --help output from an executable fixture", async () => {
		const text = await captureHelp(DUMMY);
		expect(text).toContain("--ctx-size N");
		expect(text).toContain("DEPRECATED");
	}, 10_000);

	it("returns empty string on exec failure, never throws (P4-NFR-03)", async () => {
		const text = await captureHelp("/no/such/binary");
		expect(text).toBe("");
	}, 10_000);

	it("end-to-end: captured help feeds availability map", async () => {
		const text = await captureHelp(DUMMY);
		const avail = registryAvailability(text);
		expect(avail.ctx_size?.supported).toBe(true);
		expect(avail.mlock?.deprecated ?? false).toBe(true);
		expect(avail.n_gpu_layers?.supported ?? false).toBe(false);
	}, 10_000);
});
