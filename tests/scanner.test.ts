import { afterEach, describe, expect, it } from "bun:test";
import {
	mkdirSync,
	readFileSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanModels } from "../src/core/models/scanner";
import { GgufBuilder, sampleLlamaQ4Km } from "./fixtures/gguf/build";

const TMP_ROOTS: string[] = [];

function scratch(label: string): string {
	const dir = join(tmpdir(), `scan-${label}-${Date.now()}-${Math.random()}`);
	mkdirSync(dir, { recursive: true });
	TMP_ROOTS.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of TMP_ROOTS.splice(0)) {
		try {
			rmRf(dir);
		} catch {
			// best effort cleanup
		}
	}
});

function rmRf(dir: string): void {
	import("node:fs").then((fs) =>
		fs.rmSync(dir, { recursive: true, force: true }),
	);
}

function writeGguf(dir: string, relName: string, buffer: Uint8Array): string {
	const path = join(dir, relName);
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, buffer);
	return path;
}

describe("model scanner (P3-FR-08)", () => {
	it("walks directories recursively for *.gguf and ignores noise", async () => {
		const dir = scratch("walk");
		writeGguf(dir, "top.gguf", sampleLlamaQ4Km().buffer);
		writeGguf(dir, "nested/deep/mid.gguf", sampleLlamaQ4Km().buffer);
		writeFileSync(join(dir, "notes.txt"), "noise");
		writeGguf(dir, "nested/weights.bin", new Uint8Array(16));

		const result = await scanModels([dir]);
		expect(result.entries.map((e) => e.name).sort()).toEqual([
			"mid.gguf",
			"top.gguf",
		]);
	});

	it("groups split files into ONE row with summed size + part-1 metadata", async () => {
		const dir = scratch("splits");
		const { buffer } = sampleLlamaQ4Km();
		const part1 = writeGguf(dir, "bigmodel-00001-of-00003.gguf", buffer);
		writeGguf(dir, "bigmodel-00002-of-00003.gguf", new Uint8Array(1024));
		writeGguf(dir, "bigmodel-00003-of-00003.gguf", new Uint8Array(2048));
		const part1Bytes = statSync(part1).size;

		const result = await scanModels([dir]);
		expect(result.entries.length).toBe(1);
		const row = result.entries[0];
		expect(row).toBeDefined();
		if (!row) return;
		expect(row.name).toBe("bigmodel");
		expect(row.totalBytes).toBe(part1Bytes + 1024 + 2048);
		expect(row.architecture).toBe("llama");
		expect(row.incomplete ?? false).toBe(false);
	});

	it("marks a group incomplete when a sibling is deleted", async () => {
		const dir = scratch("incomplete");
		const { buffer } = sampleLlamaQ4Km();
		writeGguf(dir, "m-00001-of-00003.gguf", buffer);
		writeGguf(dir, "m-00003-of-00003.gguf", new Uint8Array(10));

		const result = await scanModels([dir]);
		expect(result.entries[0]?.incomplete).toBe(true);
	});

	it("flags corrupt files with a typed reason; scanner survives (P3-FR-16)", async () => {
		const dir = scratch("corrupt");
		writeGguf(dir, "good.gguf", sampleLlamaQ4Km().buffer);
		writeGguf(dir, "badmagic.gguf", new Uint8Array(4096));

		const result = await scanModels([dir]);
		expect(result.entries.length).toBe(2);
		const bad = result.entries.find((e) => e.name === "badmagic.gguf");
		expect(bad?.error).toBeDefined();
		const good = result.entries.find((e) => e.name === "good.gguf");
		expect(good?.error).toBeUndefined();
	});
});

describe("metadata cache integration (P3-FR-10)", () => {
	it("warm scan re-parses ONLY changed files", async () => {
		const dir = scratch("cache");
		const stateDir = scratch("cache-state");
		const a = writeGguf(dir, "a.gguf", sampleLlamaQ4Km().buffer);
		writeGguf(dir, "b.gguf", sampleLlamaQ4Km().buffer);

		const cold = await scanModels([dir], { stateDir });
		expect(cold.stats.parsed).toBe(2);
		expect(cold.stats.cachedHits).toBe(0);

		const future = new Date(Date.now() + 5000);
		utimesSync(a, future, future);

		const warm = await scanModels([dir], { stateDir });
		expect(warm.stats.parsed).toBe(1);
		expect(warm.stats.cachedHits).toBe(1);

		const persisted = JSON.parse(
			readFileSync(join(stateDir, "models-cache.json"), "utf8"),
		);
		expect(persisted.version).toBe(1);
	});
});

describe("perf gate (P3-NFR-01)", () => {
	it("100-file warm scan completes <2s", async () => {
		const dir = scratch("perf");
		const stateDir = scratch("perf-state");
		const b = new GgufBuilder();
		b.kv("string", "general.architecture", "llama")
			.kv("u32", "general.file_type", 15)
			.tensor("token_embd.weight", [2048, 32000]);
		const small = b.build();
		for (let i = 0; i < 100; i++) {
			writeGguf(dir, `m${i}.gguf`, small);
		}
		await scanModels([dir], { stateDir });
		const t0 = performance.now();
		const warm = await scanModels([dir], { stateDir });
		const elapsed = performance.now() - t0;
		expect(warm.entries.length).toBe(100);
		expect(elapsed).toBeLessThan(2000);
	}, 10_000);
});
