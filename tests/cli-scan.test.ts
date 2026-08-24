import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sampleLlamaQ4Km } from "./fixtures/gguf/build";

describe("CLI scan/list (§9 Phase 3)", () => {
	it("lists model rows from a directory", async () => {
		const dir = join(tmpdir(), `cli-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "model.gguf"), sampleLlamaQ4Km().buffer);
		const proc = Bun.spawnSync([process.execPath, "src/cli.ts", "scan", dir]);
		const out = proc.stdout.toString();
		expect(proc.exitCode).toBe(0);
		expect(out).toContain("1 models");
		expect(out).toContain("model.gguf");
		expect(out).toContain("llama");
	});
});
