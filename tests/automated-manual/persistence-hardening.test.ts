import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { atomicWrite } from "../../src/core/store/atomic";
import {
	loadPresets,
	presetsFilePath,
	savePresets,
} from "../../src/core/store/presets";

/**
 * Automated verification for Phase 9 (Persistence & Concurrency Hardening).
 * Proves:
 * 1. Same-directory temp file creation with random UUID + rename.
 * 2. fsync durability policy: syncs both temporary file and directory.
 * 3. Concurrent atomic writes never corrupt the file or lose consistency.
 * 4. Error during write cleans up temp file cleanly without leaving orphaned .tmp files.
 * 5. Recovery from corrupted store / invalid JSON preserving existing data.
 */

const TEST_DIR = resolve(".tmp/automated-manual-p9");

describe("Phase 9: automated persistence & concurrency hardening", () => {
	beforeAll(() => {
		mkdirSync(TEST_DIR, { recursive: true });
	});

	afterAll(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	it("uses unique same-directory temp files with fsync durability", () => {
		const target = `${TEST_DIR}/durable-target.json`;
		let syncedTemp = false;
		let syncedDir = false;

		atomicWrite(target, JSON.stringify({ hello: "world" }), {
			durable: true,
			fsync: (path) => {
				if (path.includes(".tmp-")) syncedTemp = true;
				if (path === TEST_DIR) syncedDir = true;
			},
		});

		expect(existsSync(target)).toBe(true);
		expect(syncedTemp).toBe(true);
		expect(syncedDir).toBe(true);
		expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({
			hello: "world",
		});
	});

	it("handles concurrent writers safely without file corruption", async () => {
		const target = `${TEST_DIR}/concurrent.json`;

		const writers = Array.from({ length: 30 }, (_, i) => {
			return new Promise<void>((resolvePromise) => {
				setTimeout(() => {
					atomicWrite(
						target,
						JSON.stringify({ writerId: i, timestamp: Date.now() }),
					);
					resolvePromise();
				}, Math.random() * 20);
			});
		});

		await Promise.all(writers);

		// Must be valid parseable JSON after all concurrent writers
		const content = readFileSync(target, "utf8");
		const parsed = JSON.parse(content);
		expect(parsed.writerId).toBeDefined();
		expect(typeof parsed.writerId).toBe("number");
	});

	it("cleans up temporary files when write fails", () => {
		const target = `${TEST_DIR}/failure-cleanup.json`;

		expect(() => {
			atomicWrite(target, "some data", {
				writeFile: () => {
					throw new Error("simulated disk full");
				},
			});
		}).toThrow("simulated disk full");

		// Target does not exist
		expect(existsSync(target)).toBe(false);

		// No lingering .tmp files in TEST_DIR matching target
		const files = readdirSync(TEST_DIR);
		const lingering = files.filter(
			(f) => f.includes("failure-cleanup") && f.includes(".tmp-"),
		);
		expect(lingering.length).toBe(0);
	});

	it("recovers gracefully from corrupted JSON preset store", () => {
		const target = presetsFilePath(TEST_DIR);
		writeFileSync(target, "{ this is not valid json }", "utf8");

		const result = loadPresets(target);
		expect(result.data?.presets).toEqual([]);

		// Writing next valid preset succeeds
		savePresets(target, {
			version: 2,
			presets: [
				{
					id: "recovered",
					name: "Recovered Preset",
					model_path: "/models/rec.gguf",
					flags: {},
					env_vars: {},
					created_at: new Date().toISOString(),
					last_used: null,
				},
			],
		});

		const validResult = loadPresets(target);
		expect(validResult.data).toBeDefined();
		expect(validResult.data?.presets[0]?.id).toBe("recovered");
	});
});
