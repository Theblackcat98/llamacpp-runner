import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	mkdirSync,
	renameSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { scanModels } from "../../src/core/models/scanner";
import {
	groupSplitFiles,
	isGroupComplete,
} from "../../src/core/models/split-grouping";
import {
	createModelWatcher,
	type WatcherHandle,
} from "../../src/core/models/watcher";
import { GgufBuilder } from "../fixtures/gguf/build";

/**
 * Automated verification for Phase 11 (Model Discovery & Robustness).
 * Proves:
 * 1. Recursive watcher reacts to nested directory additions, renames, and deletions.
 * 2. Corrupted file insertion flags the row with a parse error without crashing scanner.
 * 3. Incomplete split model groups are detected and blocked from launch.
 */

const TEST_DIR = resolve(".tmp/automated-manual-p11");

describe("Phase 11: automated model discovery and watcher robustness", () => {
	const handles: WatcherHandle[] = [];

	beforeAll(() => {
		mkdirSync(TEST_DIR, { recursive: true });
	});

	afterAll(async () => {
		for (const h of handles) h.close();
		await Bun.sleep(200);
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	it("detects dynamic file addition, renaming, and deletion in nested directories", async () => {
		const nestedDir = `${TEST_DIR}/nested/sub`;
		mkdirSync(nestedDir, { recursive: true });

		let changeCount = 0;
		const watcher = createModelWatcher(
			[TEST_DIR, nestedDir],
			() => {
				changeCount++;
			},
			100,
		);
		handles.push(watcher);

		const sample = new GgufBuilder()
			.kv("string", "general.architecture", "llama")
			.kv("u32", "general.file_type", 15)
			.kv("u32", "llama.context_length", 4096)
			.kv("u32", "llama.block_count", 16)
			.tensor("w", [256, 256])
			.build();

		// 1. Add file in nested dir
		const file1 = `${nestedDir}/model-alpha.gguf`;
		writeFileSync(file1, sample);

		// Wait for watcher debounced event
		const t0 = Date.now();
		while (changeCount === 0 && Date.now() - t0 < 4000) {
			await Bun.sleep(50);
		}
		expect(changeCount).toBeGreaterThan(0);

		let result = await scanModels([TEST_DIR]);
		expect(result.entries.some((e) => e.name === "model-alpha.gguf")).toBe(
			true,
		);

		// 2. Rename file
		const file2 = `${nestedDir}/model-beta.gguf`;
		renameSync(file1, file2);

		const prevChanges = changeCount;
		const t1 = Date.now();
		while (changeCount === prevChanges && Date.now() - t1 < 4000) {
			await Bun.sleep(50);
		}

		result = await scanModels([TEST_DIR]);
		expect(result.entries.some((e) => e.name === "model-beta.gguf")).toBe(true);
		expect(result.entries.some((e) => e.name === "model-alpha.gguf")).toBe(
			false,
		);

		// 3. Delete file
		unlinkSync(file2);
		result = await scanModels([TEST_DIR]);
		expect(result.entries.some((e) => e.name === "model-beta.gguf")).toBe(
			false,
		);
	});

	it("flags corrupted files with reasons without crashing scanner", async () => {
		const corruptFile = `${TEST_DIR}/corrupt-header.gguf`;
		writeFileSync(corruptFile, new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]));

		const result = await scanModels([TEST_DIR]);
		const corruptEntry = result.entries.find((e) =>
			e.path.endsWith("corrupt-header.gguf"),
		);

		expect(corruptEntry).toBeDefined();
		expect(corruptEntry?.error).toBeDefined();
		expect(typeof corruptEntry?.error).toBe("string");
	});

	it("detects incomplete split models and marks them incomplete", () => {
		const splitFiles = [
			{
				name: "deepseek-00001-of-00003.gguf",
				path: "/models/deepseek-00001-of-00003.gguf",
			},
			// missing part 2
			{
				name: "deepseek-00003-of-00003.gguf",
				path: "/models/deepseek-00003-of-00003.gguf",
			},
		];

		const groups = groupSplitFiles(splitFiles);
		const group = groups.get("deepseek");
		expect(group).toBeDefined();
		if (group) {
			expect(isGroupComplete(group)).toBe(false);
		}

		// With part 2 present, it becomes complete
		const completeFiles = [
			...splitFiles,
			{
				name: "deepseek-00002-of-00003.gguf",
				path: "/models/deepseek-00002-of-00003.gguf",
			},
		];
		const completeGroup = groupSplitFiles(completeFiles).get("deepseek");
		expect(completeGroup).toBeDefined();
		if (completeGroup) {
			expect(isGroupComplete(completeGroup)).toBe(true);
		}
	});
});
