import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
	detectHardware,
	getOrDetectHardware,
} from "../src/core/hardware/detect";
import { loadConfig } from "../src/core/store/config";

const PROJECT_ROOT = join(import.meta.dir, "..");
const TMP_BASE = join(PROJECT_ROOT, ".tmp");

function createScratchDir(): string {
	mkdirSync(TMP_BASE, { recursive: true });
	return mkdtempSync(join(TMP_BASE, "hw-detect-"));
}

describe("hardware detection (Issue #7)", () => {
	let scratch: string;

	afterEach(() => {
		if (scratch) rmSync(scratch, { recursive: true, force: true });
	});

	it("parses single NVIDIA GPU from nvidia-smi", async () => {
		const result = await detectHardware({
			runCommand: async (cmd) => {
				expect(cmd).toEqual([
					"nvidia-smi",
					"--query-gpu=memory.total",
					"--format=csv,noheader,nounits",
				]);
				return { stdout: "8192\n", exitCode: 0 };
			},
			totalMem: () => 32 * 1024 * 1024 * 1024,
		});

		expect(result).toEqual({
			kind: "nvidia",
			vramBytes: 8192 * 1024 * 1024,
			totalMemBytes: 32 * 1024 * 1024 * 1024,
			source: "nvidia-smi (1 GPU)",
		});
	});

	it("sums multi-GPU NVIDIA VRAM from nvidia-smi", async () => {
		const result = await detectHardware({
			runCommand: async () => ({
				stdout: "12288\n12288\n",
				exitCode: 0,
			}),
			totalMem: () => 64 * 1024 * 1024 * 1024,
		});

		expect(result.kind).toBe("nvidia");
		expect(result.vramBytes).toBe(24576 * 1024 * 1024);
		expect(result.source).toBe("nvidia-smi (2 GPUs)");
	});

	it("detects AMD GPU from /sys/class/drm sysfs when nvidia-smi is unavailable", async () => {
		const result = await detectHardware({
			runCommand: async () => {
				throw new Error("command not found: nvidia-smi");
			},
			listDrmCards: () => ["card0", "card1"],
			readSysfs: (path) => {
				if (path === "/sys/class/drm/card0/device/mem_info_vram_total") {
					return "17179869184\n"; // 16 GiB in bytes
				}
				return null;
			},
			totalMem: () => 32 * 1024 * 1024 * 1024,
		});

		expect(result).toEqual({
			kind: "amd",
			vramBytes: 17179869184,
			totalMemBytes: 32 * 1024 * 1024 * 1024,
			source: "/sys/class/drm (1 device)",
		});
	});

	it("falls back to CPU and os.totalmem when GPU detection finds no GPUs", async () => {
		const result = await detectHardware({
			runCommand: async () => ({ stdout: "", exitCode: 1 }),
			listDrmCards: () => [],
			totalMem: () => 16 * 1024 * 1024 * 1024,
		});

		expect(result).toEqual({
			kind: "cpu",
			vramBytes: null,
			totalMemBytes: 16 * 1024 * 1024 * 1024,
			source: "os.totalmem (cpu fallback)",
		});
	});

	it("falls back to CPU without throwing when commands crash", async () => {
		const result = await detectHardware({
			runCommand: async () => {
				throw new Error("unexpected spawn failure");
			},
			listDrmCards: () => {
				throw new Error("permission denied");
			},
			totalMem: () => 16 * 1024 * 1024 * 1024,
		});

		expect(result.kind).toBe("cpu");
		expect(result.vramBytes).toBeNull();
		expect(result.totalMemBytes).toBe(16 * 1024 * 1024 * 1024);
	});

	it("caches result in config and re-reads unless reprobe requested", async () => {
		scratch = createScratchDir();
		const configDir = join(scratch, "config");
		mkdirSync(configDir, { recursive: true });

		let probeCount = 0;
		const deps = {
			runCommand: async () => {
				probeCount++;
				return { stdout: "8192\n", exitCode: 0 };
			},
			totalMem: () => 32 * 1024 * 1024 * 1024,
		};

		const first = await getOrDetectHardware(configDir, { deps });
		expect(probeCount).toBe(1);
		expect(first.kind).toBe("nvidia");

		const cachedConfig = loadConfig(configDir);
		expect(cachedConfig.hardware).toEqual(first);

		// Second call should use cached config without probing
		const second = await getOrDetectHardware(configDir, { deps });
		expect(probeCount).toBe(1);
		expect(second).toEqual(first);

		// With reprobe: true, probe should run again
		const reprobed = await getOrDetectHardware(configDir, {
			reprobe: true,
			deps,
		});
		expect(probeCount).toBe(2);
		expect(reprobed).toEqual(first);
	});
});
