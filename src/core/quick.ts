/**
 * Quick run command generator and runner (§3, Issue #10).
 * Composes hardware detection, model-native defaults, and VRAM estimation into
 * a deterministic single-verb launcher.
 */

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_CONTEXT, LLAMA_SERVER_BIN } from "./constants";
import { computeAutoFitNgl } from "./estimate/auto-fit";
import { estimateVram, type VramEstimate } from "./estimate/vram";
import { buildCommand } from "./flags/builder";
import type { FlagAvailability } from "./flags/help-parser";
import { REGISTRY } from "./flags/registry";
import { probeBinaryAvailability } from "./flags/validate";
import { extractModelInfo, parseGgufFile } from "./gguf/parser";
import type { ModelInfo } from "./gguf/types";
import { getOrDetectHardware, type HardwareInfo } from "./hardware/detect";
import { Supervisor } from "./process/supervisor";
import type { LaunchPlan } from "./session";
import { clearPidFile, writePidFile } from "./store/pidfile";

export interface QuickResult {
	plan: LaunchPlan;
	estimate: VramEstimate | null;
	modelInfo: ModelInfo;
	hardware: HardwareInfo | null;
	conservativeFallback: boolean;
	fallbackReason?: string;
}

export interface ResolveQuickOptions {
	configDir?: string;
	binaryPath?: string;
	hardware?: HardwareInfo | null;
	availability?: Record<string, FlagAvailability>;
}

export async function resolveBinaryAvailability(
	binaryPath: string | undefined,
): Promise<Record<string, FlagAvailability>> {
	// Issue #19: probe AT the resolved path so PATH-found binaries are
	// actually validated; unverified binaries yield {} (fail-open launch).
	const probed = await probeBinaryAvailability({ configured: binaryPath });
	return probed.availability;
}

export async function resolveQuick(
	modelPath: string,
	opts?: ResolveQuickOptions,
): Promise<QuickResult> {
	const absPath = resolve(modelPath);
	if (!existsSync(absPath)) {
		throw new Error(`Model file not found: ${modelPath}`);
	}

	const header = await parseGgufFile(absPath);
	const modelInfo = extractModelInfo(header);
	const fileSize = statSync(absPath).size;

	// Populate model-native defaults from REGISTRY
	const values: Record<string, unknown> = {};
	for (const [id, entry] of Object.entries(REGISTRY)) {
		if (entry.default !== null) {
			values[id] = entry.default;
		}
	}

	// Model-native context length clamping
	const contextLength =
		modelInfo.contextLength !== undefined
			? Math.min(DEFAULT_CONTEXT, modelInfo.contextLength)
			: DEFAULT_CONTEXT;
	values.ctx_size = contextLength;

	// Resolve hardware detection (explicit or cached/probed)
	let hardware: HardwareInfo | null = null;
	if (opts?.hardware !== undefined) {
		hardware = opts.hardware;
	} else if (opts?.configDir) {
		hardware = await getOrDetectHardware(opts.configDir);
	}

	let conservativeFallback = false;
	let fallbackReason: string | undefined;

	const hasEstimatorMetadata =
		modelInfo.blockCount !== undefined &&
		modelInfo.headCount !== undefined &&
		modelInfo.headCountKv !== undefined &&
		modelInfo.embeddingLength !== undefined;

	const vram = hardware?.vramBytes;
	const hasGpu = typeof vram === "number" && vram > 0;

	if (hasGpu && hasEstimatorMetadata) {
		const maxNgl = (modelInfo.blockCount as number) + 1;
		const fit = computeAutoFitNgl(
			{
				fileSize,
				blockCount: modelInfo.blockCount as number,
				contextLength,
				headCount: modelInfo.headCount as number,
				headCountKv: modelInfo.headCountKv as number,
				embeddingLength: modelInfo.embeddingLength as number,
				keyLength: modelInfo.keyLength,
				kvQuantK: "f16",
				kvQuantV: "f16",
			},
			vram,
			maxNgl,
		);
		values.n_gpu_layers = fit.ngl;
	} else {
		conservativeFallback = true;
		values.n_gpu_layers = 0;
		if (!hasGpu) {
			fallbackReason =
				hardware?.kind === "cpu"
					? "No GPU detected (CPU system) — falling back to conservative defaults (n_gpu_layers=0)"
					: "Hardware detection unavailable — falling back to conservative defaults (n_gpu_layers=0)";
		} else {
			fallbackReason =
				"Incomplete model metadata for VRAM estimation — falling back to conservative defaults (n_gpu_layers=0)";
		}
	}

	// Compute VRAM estimate
	let estimate: VramEstimate | null = null;
	if (hasEstimatorMetadata) {
		estimate = estimateVram({
			fileSize,
			blockCount: modelInfo.blockCount as number,
			contextLength,
			headCount: modelInfo.headCount as number,
			headCountKv: modelInfo.headCountKv as number,
			embeddingLength: modelInfo.embeddingLength as number,
			keyLength: modelInfo.keyLength,
			gpuLayers: values.n_gpu_layers as number,
			kvQuantK: "f16",
			kvQuantV: "f16",
		});
	}

	const command =
		opts?.binaryPath || process.env.LLAMA_SERVER_BIN || LLAMA_SERVER_BIN;

	const built = buildCommand({
		modelPath: absPath,
		meta: { blockCount: modelInfo.blockCount },
		values,
		availability: opts?.availability,
	});

	const plan: LaunchPlan = {
		command,
		args: built.args,
		port: typeof values.port === "number" ? values.port : 8080,
		host: typeof values.host === "string" ? values.host : "127.0.0.1",
		presetId: "quick",
	};

	return {
		plan,
		estimate,
		modelInfo,
		hardware,
		conservativeFallback,
		fallbackReason,
	};
}

export interface RunSupervisorOptions {
	pidFile?: string;
	onLog?: (line: string) => void;
	readyPattern?: RegExp;
}

/**
 * Runs a resolved plan through Supervisor (§6.2 zero-orphan lifecycle).
 */
export async function runQuickSupervisor(
	plan: LaunchPlan,
	opts?: RunSupervisorOptions,
): Promise<number> {
	const supervisor = new Supervisor({
		command: plan.command,
		args: plan.args,
		port: plan.port,
		host: plan.host ?? "127.0.0.1",
		readyPattern: opts?.readyPattern ?? /listening on|server is listening/i,
		timings: plan.timings,
		env: plan.env,
	});

	if (opts?.onLog) {
		supervisor.onLog(opts.onLog);
	}

	const pidFile = opts?.pidFile;

	const onSig = async () => {
		if (pidFile) clearPidFile(pidFile);
		await supervisor.teardown();
		process.exit(0);
	};

	process.on("SIGINT", onSig);
	process.on("SIGTERM", onSig);
	process.on("exit", () => {
		if (pidFile) clearPidFile(pidFile);
	});

	const exitPromise = new Promise<number>((resolve) => {
		supervisor.onState((event) => {
			if (
				event.state === "LOADING" &&
				supervisor.pid !== undefined &&
				pidFile
			) {
				writePidFile(pidFile, {
					pid: supervisor.pid,
					port: plan.port,
					startedAt: new Date().toISOString(),
				});
			}
			if (event.state === "IDLE") {
				if (pidFile) clearPidFile(pidFile);
				resolve(event.exitCode ?? 0);
			} else if (event.state === "FAILED") {
				if (pidFile) clearPidFile(pidFile);
				resolve(event.exitCode ?? 1);
			}
		});
	});

	try {
		await supervisor.start();
		return await exitPromise;
	} finally {
		process.removeListener("SIGINT", onSig);
		process.removeListener("SIGTERM", onSig);
		if (pidFile) clearPidFile(pidFile);
	}
}
