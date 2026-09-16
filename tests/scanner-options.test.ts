import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_CONCURRENCY,
	DEFAULT_MAX_DEPTH,
	scanModels,
} from "../src/core/models/scanner";
import { sampleLlamaQ4Km } from "./fixtures/gguf/build";

const TMP_ROOTS: string[] = [];

function scratch(label: string): string {
	const dir = join(
		tmpdir(),
		`scan-opt-${label}-${Date.now()}-${Math.random()}`,
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

function writeGguf(dir: string, relName: string): string {
	const path = join(dir, relName);
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, sampleLlamaQ4Km().buffer);
	return path;
}

const names = (entries: { name: string }[]): string[] =>
	entries.map((e) => e.name).sort();

describe("scanner options: symlinks (#23)", () => {
	it("skips dir and file symlinks by default", async () => {
		const dir = scratch("links-default");
		writeGguf(dir, "real/model.gguf");
		writeGguf(dir, "real/sub/other.gguf");
		symlinkSync(join(dir, "real/sub"), join(dir, "linked-sub"));
		symlinkSync(join(dir, "real/model.gguf"), join(dir, "linked-model.gguf"));

		const result = await scanModels([dir]);
		expect(names(result.entries)).toEqual(["model.gguf", "other.gguf"]);
	});

	it("follows dir and file symlinks when followSymlinks: true", async () => {
		const dir = scratch("links-follow");
		writeGguf(dir, "real/model.gguf");
		writeGguf(dir, "real/sub/other.gguf");
		symlinkSync(join(dir, "real/sub"), join(dir, "linked-sub"));
		symlinkSync(join(dir, "real/model.gguf"), join(dir, "linked-model.gguf"));

		const result = await scanModels([dir], { followSymlinks: true });
		expect(names(result.entries)).toEqual([
			"linked-model.gguf",
			"model.gguf",
			"other.gguf",
			"other.gguf",
		]);
	});

	it("follows a symlinked scan root when followSymlinks: true", async () => {
		const dir = scratch("links-root");
		writeGguf(dir, "real/model.gguf");
		const rootLink = join(dir, "root-link");
		symlinkSync(join(dir, "real"), rootLink);

		const skipped = await scanModels([rootLink]);
		expect(skipped.entries).toEqual([]);

		const followed = await scanModels([rootLink], { followSymlinks: true });
		expect(names(followed.entries)).toEqual(["model.gguf"]);
	});

	it("terminates on symlink cycles instead of recursing forever", async () => {
		const dir = scratch("links-cycle");
		writeGguf(dir, "model.gguf");
		symlinkSync(dir, join(dir, "loop"));

		const result = await scanModels([dir], { followSymlinks: true });
		expect(names(result.entries)).toEqual(["model.gguf"]);
	}, 15_000);

	it("reports broken symlinks via errors instead of crashing", async () => {
		const dir = scratch("links-broken");
		writeGguf(dir, "model.gguf");
		symlinkSync(join(dir, "missing.gguf"), join(dir, "broken.gguf"));
		const seen: string[] = [];

		const result = await scanModels([dir], {
			followSymlinks: true,
			onError: (path) => seen.push(path),
		});
		expect(names(result.entries)).toEqual(["model.gguf"]);
		expect((result.errors ?? []).some((e) => e.includes("broken.gguf"))).toBe(
			true,
		);
		expect(seen.some((p) => p.includes("broken.gguf"))).toBe(true);
	});
});

describe("scanner options: concurrency validation (#23)", () => {
	it("rejects zero workers instead of hanging queued jobs", async () => {
		const dir = scratch("conc-zero");
		writeGguf(dir, "model.gguf");
		await expect(scanModels([dir], { concurrency: 0 })).rejects.toThrow(
			RangeError,
		);
	}, 15_000);

	it("rejects negative worker counts", async () => {
		const dir = scratch("conc-neg");
		writeGguf(dir, "model.gguf");
		await expect(scanModels([dir], { concurrency: -3 })).rejects.toThrow(
			RangeError,
		);
	});

	it("rejects fractional worker counts", async () => {
		const dir = scratch("conc-frac");
		writeGguf(dir, "model.gguf");
		await expect(scanModels([dir], { concurrency: 1.5 })).rejects.toThrow(
			RangeError,
		);
	});

	it("accepts an explicit positive worker count", async () => {
		const dir = scratch("conc-ok");
		writeGguf(dir, "model.gguf");
		const result = await scanModels([dir], { concurrency: 2 });
		expect(names(result.entries)).toEqual(["model.gguf"]);
	});

	it("keeps the documented default worker count", () => {
		expect(DEFAULT_CONCURRENCY).toBe(4);
	});
});

describe("scanner options: depth limit (#23)", () => {
	it("exposes the default depth limit as a constant", () => {
		expect(DEFAULT_MAX_DEPTH).toBe(3);
	});

	it("walks at most DEFAULT_MAX_DEPTH layers by default", async () => {
		const dir = scratch("depth-default");
		writeGguf(dir, "top.gguf");
		writeGguf(dir, "l1/l1.gguf");
		writeGguf(dir, "l1/l2/l2.gguf");
		writeGguf(dir, "l1/l2/l3/l3.gguf");
		writeGguf(dir, "l1/l2/l3/l4/l4.gguf");

		const result = await scanModels([dir]);
		expect(names(result.entries)).toEqual([
			"l1.gguf",
			"l2.gguf",
			"l3.gguf",
			"top.gguf",
		]);
	});

	it("maxDepth: 0 walks only the top level", async () => {
		const dir = scratch("depth-zero");
		writeGguf(dir, "top.gguf");
		writeGguf(dir, "nested/mid.gguf");

		const result = await scanModels([dir], { maxDepth: 0 });
		expect(names(result.entries)).toEqual(["top.gguf"]);
	});

	it("honors an explicit maxDepth", async () => {
		const dir = scratch("depth-explicit");
		writeGguf(dir, "top.gguf");
		writeGguf(dir, "nested/mid.gguf");
		writeGguf(dir, "nested/deep/bottom.gguf");

		const result = await scanModels([dir], { maxDepth: 1 });
		expect(names(result.entries)).toEqual(["mid.gguf", "top.gguf"]);
	});

	it("rejects negative maxDepth", async () => {
		const dir = scratch("depth-neg");
		writeGguf(dir, "model.gguf");
		await expect(scanModels([dir], { maxDepth: -1 })).rejects.toThrow(
			RangeError,
		);
	});
});
