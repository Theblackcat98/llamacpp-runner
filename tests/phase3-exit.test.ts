import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanModels } from "../src/core/models/scanner";
import { GgufBuilder } from "./fixtures/gguf/build";

/**
 * Phase 3 EXIT criterion (spec §9): a 100-file directory parses <2 s warm;
 * corrupt files are flagged and the scanner survives.
 */
describe("PHASE 3 EXIT", () => {
	it("100-file directory parses <2s warm with corrupt files flagged", async () => {
		const dir = join(tmpdir(), `p3-exit-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		const b = new GgufBuilder();
		b.kv("string", "general.architecture", "llama")
			.kv("u32", "general.file_type", 15)
			.tensor("t.weight", [2048, 32000]);
		const good = b.build();
		for (let i = 0; i < 98; i++) {
			writeFileSync(join(dir, `m${i}.gguf`), good);
		}
		writeFileSync(join(dir, "corrupt1.gguf"), new Uint8Array(4096));
		writeFileSync(join(dir, "corrupt2.gguf"), Buffer.from("NOTGGUFgarbage"));

		const stateDir = join(tmpdir(), `p3-exit-state-${Date.now()}`);
		await scanModels([dir], { stateDir }); // cold

		const t0 = performance.now();
		const warm = await scanModels([dir], { stateDir });
		const elapsed = performance.now() - t0;

		expect(warm.entries.length).toBe(100);
		const flagged = warm.entries.filter((e) => e.error);
		expect(flagged.length).toBe(2);
		expect(elapsed).toBeLessThan(2000);
	}, 10_000);
});
