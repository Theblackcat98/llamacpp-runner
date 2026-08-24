import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	type FlagAvailability,
	parseHelp,
	registryAvailability,
} from "../src/core/flags/help-parser";

const REAL = readFileSync(
	join(import.meta.dir, "fixtures/help/real-b6000.txt"),
	"utf8",
);

/** P4-FR-04, P4-NFR-03: tolerant parse of real --help captures. */
describe("help parser", () => {
	it("parses the captured real llama-server --help", () => {
		const index = parseHelp(REAL);
		expect(index.has("--ctx-size")).toBe(true);
		expect(index.has("-c")).toBe(true);
		expect(index.has("--n-gpu-layers")).toBe(true);
		expect(index.has("-ngl")).toBe(true);
		expect(index.has("--cache-type-k")).toBe(true);
		expect(index.has("--metrics")).toBe(true);
		expect(index.has("--slots")).toBe(true);
		expect(index.has("--alias")).toBe(true);
		expect(index.has("--chat-template")).toBe(true);
	});

	it("detects deprecated flags in the real capture (--mlock)", () => {
		const index = parseHelp(REAL);
		expect(index.deprecated.has("--mlock")).toBe(true);
		expect(index.deprecated.has("--ctx-size")).toBe(false);
	});

	it("absent flags are reported unsupported (older binary)", () => {
		const index = parseHelp(REAL);
		expect(index.has("--definitely-not-a-real-flag")).toBe(false);
	});

	it("tolerant to drift: garbage/empty input never throws (P4-NFR-03)", () => {
		expect(() => parseHelp("")).not.toThrow();
		expect(() => parseHelp("total garbage\nno flags here\n")).not.toThrow();
		const empty = parseHelp("");
		expect(empty.has("--ctx-size")).toBe(false);
		expect(
			parseHelp("\n\nrandom text --notflag\n").size(),
		).toBeGreaterThanOrEqual(0);
	});
});

describe("registry availability (P4-FR-04)", () => {
	it("maps every registry flag against the real binary capture", () => {
		const avail = registryAvailability(REAL);
		for (const id of [
			"n_gpu_layers",
			"ctx_size",
			"batch_size",
			"ubatch_size",
			"threads",
			"flash_attn",
			"no_mmap",
			"cache_type_k",
			"cache_type_v",
			"host",
			"port",
			"chat_template",
			"slots",
			"metrics",
			"alias",
		]) {
			expect(avail[id]?.supported, `${id} should be supported`).toBe(true);
		}
	});

	it("marks mlock deprecated in the real binary (§7 binary-too-old row)", () => {
		const avail: Record<string, FlagAvailability> = registryAvailability(REAL);
		expect(avail.mlock?.deprecated ?? false).toBe(true);
	});

	it("synthetic old-format help: missing flags come out disabled", () => {
		const oldHelp = [
			"usage: llama-server [options]",
			"",
			"-c, --ctx-size N      size of the prompt context",
			"--port PORT           port to listen",
			"-t, --threads N       threads",
			"",
		].join("\n");
		const avail = registryAvailability(oldHelp);
		expect(avail.ctx_size?.supported).toBe(true);
		expect(avail.port?.supported).toBe(true);
		expect(avail.threads?.supported).toBe(true);
		expect(avail.n_gpu_layers?.supported ?? false).toBe(false);
		expect(avail.metrics?.supported ?? false).toBe(false);
		expect(avail.slots?.supported ?? false).toBe(false);
		expect(avail.flash_attn?.supported ?? false).toBe(false);
	});

	it("empty help text -> everything disabled, registry idles safely", () => {
		const avail = registryAvailability("");
		expect(Object.keys(avail).length).toBeGreaterThan(0);
		for (const value of Object.values(avail)) {
			expect(value.supported).toBe(false);
		}
	});
});
