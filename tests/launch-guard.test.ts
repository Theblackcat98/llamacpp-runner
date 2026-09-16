import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	entryLaunchBlocker,
	splitIncompleteReason,
} from "../src/core/models/launch-guard";
import type { ModelEntry } from "../src/core/models/types";

const TMP_ROOTS: string[] = [];

function scratch(label: string): string {
	const dir = join(
		tmpdir(),
		`launch-guard-${label}-${Date.now()}-${Math.random()}`,
	);
	mkdirSync(dir, { recursive: true });
	TMP_ROOTS.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of TMP_ROOTS.splice(0)) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			// best effort cleanup
		}
	}
});

function entry(overrides: Partial<ModelEntry> = {}): ModelEntry {
	return {
		name: "m",
		path: "/models/m.gguf",
		paths: ["/models/m.gguf"],
		totalBytes: 1,
		quantName: "Q4_K_M",
		...overrides,
	};
}

describe("entryLaunchBlocker (#18)", () => {
	it("passes a healthy standalone entry", () => {
		expect(entryLaunchBlocker(entry())).toBeNull();
	});

	it("passes a complete split group", () => {
		expect(entryLaunchBlocker(entry({ incomplete: false }))).toBeNull();
	});

	it("blocks a parse-error entry with the reason", () => {
		const reason = entryLaunchBlocker(entry({ error: "bad magic" }));
		expect(reason).toContain("parse error");
		expect(reason).toContain("bad magic");
	});

	it("blocks an incomplete split group with recovery guidance", () => {
		const reason = entryLaunchBlocker(
			entry({ name: "bigmodel", incomplete: true }),
		);
		expect(reason).toContain("bigmodel");
		expect(reason).toContain("incomplete split");
		expect(reason).toContain("rescan");
	});

	it("blocks an undefined selection", () => {
		expect(entryLaunchBlocker(undefined)).toContain("no model");
	});
});

describe("splitIncompleteReason (#18)", () => {
	it("null for a complete split group on disk", () => {
		const dir = scratch("complete");
		for (const part of ["m-00001-of-00002.gguf", "m-00002-of-00002.gguf"]) {
			writeFileSync(join(dir, part), "x");
		}
		expect(
			splitIncompleteReason(join(dir, "m-00001-of-00002.gguf")),
		).toBeNull();
	});

	it("names the missing parts of an incomplete group", () => {
		const dir = scratch("incomplete");
		writeFileSync(join(dir, "m-00001-of-00003.gguf"), "x");
		writeFileSync(join(dir, "m-00003-of-00003.gguf"), "x");
		const reason = splitIncompleteReason(join(dir, "m-00001-of-00003.gguf"));
		expect(reason).toContain("incomplete split");
		expect(reason).toContain("m");
		expect(reason).toContain("2 of 3");
	});

	it("recovers to null once the missing part is added", () => {
		const dir = scratch("recovery");
		writeFileSync(join(dir, "m-00001-of-00002.gguf"), "x");
		const path = join(dir, "m-00001-of-00002.gguf");
		expect(splitIncompleteReason(path)).toContain("incomplete split");
		writeFileSync(join(dir, "m-00002-of-00002.gguf"), "x");
		expect(splitIncompleteReason(path)).toBeNull();
	});

	it("null for a non-split path", () => {
		const dir = scratch("standalone");
		writeFileSync(join(dir, "solo.gguf"), "x");
		expect(splitIncompleteReason(join(dir, "solo.gguf"))).toBeNull();
	});

	it("null when the path does not exist (not this guard's concern)", () => {
		expect(
			splitIncompleteReason("/nope/missing-00001-of-00002.gguf"),
		).toBeNull();
	});
});
