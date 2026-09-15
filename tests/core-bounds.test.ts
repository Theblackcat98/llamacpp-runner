import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBus } from "../src/core/bus";
import type { IntentMap, StateMap } from "../src/core/bus-contract";
import { estimateFromModelInfo, estimateVram } from "../src/core/estimate/vram";
import { scanModels } from "../src/core/models/scanner";
import { createModelsService } from "../src/core/models/service";
import { resolvePaths } from "../src/core/store/state-paths";
import { sampleLlamaQ4Km } from "./fixtures/gguf/build";

const DIRS: string[] = [];

afterEach(() => {
	for (const d of DIRS.splice(0)) {
		try {
			rmSync(d, { recursive: true, force: true });
		} catch {}
	}
});

function scratch(label: string): string {
	const dir = join(
		tmpdir(),
		`core-bounds-${label}-${Date.now()}-${Math.random()}`,
	);
	mkdirSync(dir, { recursive: true });
	DIRS.push(dir);
	return dir;
}

describe("VRAM estimate bounds on zero/missing fileSize (P3, §3.2)", () => {
	it("flags missing or zero fileSize in limitations", () => {
		const result = estimateVram({
			fileSize: 0,
			blockCount: 32,
			contextLength: 4096,
			headCount: 32,
			headCountKv: 8,
			embeddingLength: 4096,
			gpuLayers: 33,
		});
		const missingLimitation = result.limitations.find(
			(l) => l.code === "missing-file-size",
		);
		expect(missingLimitation).toBeDefined();
		expect(missingLimitation?.message).toBe(
			"model missing — estimate unavailable",
		);
	});

	it("estimateFromModelInfo returns null when fileSize <= 0", () => {
		const result = estimateFromModelInfo(
			{
				blockCount: 32,
				headCount: 32,
				headCountKv: 8,
				embeddingLength: 4096,
				quantName: "Q4_K_M",
				totalParams: 7_000_000_000,
			},
			0,
			33,
			4096,
		);
		expect(result).toBeNull();
	});
});

describe("scanner recursion bounds (§3.1)", () => {
	it("limits directory recursion to maxDepth (default 3 layers)", async () => {
		const root = scratch("depth");
		const d1 = join(root, "l1");
		const d2 = join(d1, "l2");
		const d3 = join(d2, "l3");
		const d4 = join(d3, "l4");
		mkdirSync(d4, { recursive: true });

		const buf = sampleLlamaQ4Km().buffer;
		writeFileSync(join(root, "m0.gguf"), buf);
		writeFileSync(join(d1, "m1.gguf"), buf);
		writeFileSync(join(d2, "m2.gguf"), buf);
		writeFileSync(join(d3, "m3.gguf"), buf);
		writeFileSync(join(d4, "m4.gguf"), buf);

		const res = await scanModels([root]);
		const names = res.entries.map((e) => e.name).sort();
		expect(names).toContain("m0.gguf");
		expect(names).toContain("m1.gguf");
		expect(names).toContain("m2.gguf");
		expect(names).toContain("m3.gguf");
		// m4.gguf is 4 layers deep, should not be included with default maxDepth = 3
		expect(names).not.toContain("m4.gguf");
	});
});

describe("state paths ~/.configs fallback", () => {
	it("uses ~/.configs when it exists and XDG_CONFIG_HOME is unset", () => {
		const fakeHome = scratch("home");
		const configsDir = join(fakeHome, ".configs");
		mkdirSync(configsDir, { recursive: true });

		const paths = resolvePaths({}, fakeHome);
		expect(paths.configDir).toBe(join(configsDir, "llama-deck"));
	});
});

describe("models service default directory fallback", () => {
	it("defaults to process.cwd() when config and presets have no modelsDir", () => {
		const stateDir = scratch("state");
		const configDir = scratch("config");
		const bus = createBus<IntentMap, StateMap>();

		let emittedDir: string | null | undefined;
		bus.onState("MODELS_DIR", (e) => {
			emittedDir = e.dir;
		});

		const svc = createModelsService(
			bus,
			{
				stateDir,
				configDir,
				pidFile: join(stateDir, "server.pid"),
			},
			{ defaultDir: process.cwd() },
		);

		svc.boot();
		expect(emittedDir).toBe(process.cwd());
		svc.dispose();
	});
});
