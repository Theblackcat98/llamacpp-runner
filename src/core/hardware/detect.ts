import { existsSync, readdirSync, readFileSync } from "node:fs";
import { totalmem } from "node:os";
import { loadConfig, saveConfig } from "../store/config";

export type HardwareKind = "nvidia" | "amd" | "cpu";

export interface HardwareInfo {
	kind: HardwareKind;
	vramBytes: number | null;
	totalMemBytes: number;
	source: string;
}

export interface HardwareProbeDeps {
	runCommand?: (cmd: string[]) => Promise<{ stdout: string; exitCode: number }>;
	readSysfs?: (path: string) => string | null;
	listDrmCards?: () => string[];
	totalMem?: () => number;
}

async function defaultRunCommand(
	cmd: string[],
): Promise<{ stdout: string; exitCode: number }> {
	const proc = Bun.spawn(cmd, {
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout = await new Response(proc.stdout).text();
	const exitCode = await proc.exited;
	return { stdout, exitCode };
}

function defaultReadSysfs(path: string): string | null {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return null;
	}
}

function defaultListDrmCards(): string[] {
	try {
		const drmDir = "/sys/class/drm";
		if (!existsSync(drmDir)) return [];
		return readdirSync(drmDir).filter((name) => /^card\d+$/.test(name));
	} catch {
		return [];
	}
}

/**
 * Probes GPU VRAM and system memory.
 * Prioritizes NVIDIA (nvidia-smi), then AMD (/sys/class/drm), falling back
 * safely to CPU/RAM without ever throwing.
 */
export async function detectHardware(
	deps?: HardwareProbeDeps,
): Promise<HardwareInfo> {
	const runCmd = deps?.runCommand ?? defaultRunCommand;
	const readSys = deps?.readSysfs ?? defaultReadSysfs;
	const listCards = deps?.listDrmCards ?? defaultListDrmCards;
	const getMem = deps?.totalMem ?? totalmem;

	const fallbackMem = () => {
		try {
			return getMem();
		} catch {
			return 0;
		}
	};

	// 1. Try NVIDIA SMI
	try {
		const { stdout, exitCode } = await runCmd([
			"nvidia-smi",
			"--query-gpu=memory.total",
			"--format=csv,noheader,nounits",
		]);
		if (exitCode === 0 && stdout.trim().length > 0) {
			const lines = stdout
				.trim()
				.split("\n")
				.map((l) => l.trim())
				.filter(Boolean);
			const mibs = lines
				.map((l) => Number.parseInt(l, 10))
				.filter((n) => !Number.isNaN(n) && n > 0);
			if (mibs.length > 0) {
				const totalMib = mibs.reduce((a, b) => a + b, 0);
				return {
					kind: "nvidia",
					vramBytes: totalMib * 1024 * 1024,
					totalMemBytes: fallbackMem(),
					source: `nvidia-smi (${mibs.length} GPU${mibs.length > 1 ? "s" : ""})`,
				};
			}
		}
	} catch {
		// nvidia-smi not available or errored - proceed to AMD
	}

	// 2. Try AMD sysfs
	try {
		const cards = listCards();
		let totalAmdBytes = 0;
		let deviceCount = 0;
		for (const card of cards) {
			const content = readSys(
				`/sys/class/drm/${card}/device/mem_info_vram_total`,
			);
			if (content) {
				const bytes = Number.parseInt(content.trim(), 10);
				if (!Number.isNaN(bytes) && bytes > 0) {
					totalAmdBytes += bytes;
					deviceCount++;
				}
			}
		}
		if (totalAmdBytes > 0) {
			return {
				kind: "amd",
				vramBytes: totalAmdBytes,
				totalMemBytes: fallbackMem(),
				source: `/sys/class/drm (${deviceCount} device${deviceCount > 1 ? "s" : ""})`,
			};
		}
	} catch {
		// sysfs error - proceed to fallback
	}

	// 3. Fallback to CPU RAM
	return {
		kind: "cpu",
		vramBytes: null,
		totalMemBytes: fallbackMem(),
		source: "os.totalmem (cpu fallback)",
	};
}

/**
 * Gets cached hardware probe from config if present, or performs a probe
 * and caches the result under $XDG_CONFIG_HOME/llama-deck/ (Issue #7).
 */
export async function getOrDetectHardware(
	configDir: string,
	options?: { reprobe?: boolean; deps?: HardwareProbeDeps },
): Promise<HardwareInfo> {
	if (!options?.reprobe) {
		const config = loadConfig(configDir);
		if (config.hardware) {
			return config.hardware;
		}
	}
	const detected = await detectHardware(options?.deps);
	try {
		const config = loadConfig(configDir);
		saveConfig(configDir, { ...config, hardware: detected });
	} catch {
		// Ignore write errors if configDir is not writable
	}
	return detected;
}
