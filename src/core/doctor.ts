/**
 * doctor: deterministic launch-readiness diagnostic (Issue #24).
 *
 * `buildDoctorReport` explains the exact launch environment for a preset
 * WITHOUT starting a server: binary resolution, runtime flag compatibility,
 * model metadata, the effective argv (via the same `presetToPlan` builder
 * `start` uses, so diagnostics cannot drift from runtime behavior), VRAM
 * estimate with limitations, telemetry endpoint, and pidfile process
 * ownership. Blockers (would refuse launch) are reported separately from
 * warnings.
 *
 * All side-effecting probes are injected through `DoctorDeps` so unit tests
 * stay deterministic; the CLI wires the real implementations. `src/core`
 * never imports `src/ui` (D5) — output is plain data + a text formatter.
 */
import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { DEFAULT_CONTEXT, DEFAULT_HOST } from "./constants";
import { estimateVram, type KvQuant } from "./estimate/vram";
import { commandLine } from "./flags/builder";
import { getFlag } from "./flags/registry";
import { type ProbeResult, probeBinaryAvailability } from "./flags/validate";
import { sanitizeValues, type ValueIssue } from "./flags/validate-values";
import { extractModelInfo, parseGgufFile } from "./gguf/parser";
import type { ModelInfo } from "./gguf/types";
import { getOrDetectHardware, type HardwareInfo } from "./hardware/detect";
import { splitIncompleteReason } from "./models/launch-guard";
import { presetToPlan } from "./preset-launch";
import {
	defaultProcessInspector,
	isLlamaServerCommand,
} from "./process/identity";
import { readPidFile } from "./store/pidfile";
import type { Preset } from "./store/presets";

export const DOCTOR_SCHEMA = "llama-deck.doctor/v1" as const;

export interface DoctorTarget {
	preset: Preset & { binary_path?: string };
}

export interface DoctorPaths {
	configDir: string;
	stateDir: string;
	pidFile: string;
}

export interface ModelRead {
	info: ModelInfo;
	fileSize: number;
}

export interface ProcessInspection {
	status: "none" | "stale" | "alive" | "unknown";
	pid: number | null;
}

export interface DoctorDeps {
	now?: () => string;
	fileExists?: (path: string) => boolean;
	probeBinary?: (configured?: string) => Promise<ProbeResult>;
	readModelInfo?: (absPath: string) => Promise<ModelRead>;
	detectHardware?: (configDir: string) => Promise<HardwareInfo | null>;
	inspectProcess?: (pidFile: string) => Promise<ProcessInspection>;
	splitCheck?: (absPath: string) => string | null;
}

export interface DoctorReport {
	schema: typeof DOCTOR_SCHEMA;
	generatedAt: string;
	target:
		| { kind: "preset"; id: string; name: string }
		| { kind: "model"; path: string };
	binary: {
		status: "ok" | "missing";
		path: string | null;
		helpVerified: boolean;
		probedFlags: number;
	};
	model: {
		path: string;
		exists: boolean;
		metadata: ModelInfo | null;
		incompleteSplit: string | null;
	};
	flags: {
		effective: Record<string, unknown>;
		issues: ValueIssue[];
		droppedUnsupported: string[];
	};
	plan: {
		command: string;
		args: string[];
		commandLine: string;
		host: string;
		port: number;
	};
	estimate: {
		vramRangeBytes: { low: number; high: number };
		limitations: { code: string; message: string }[];
		hardware: {
			kind: string;
			vramBytes: number | null;
			totalMemBytes: number | null;
		} | null;
	} | null;
	telemetry: {
		enabled: boolean;
		endpoint: string;
	};
	process: ProcessInspection;
	blockers: string[];
	warnings: string[];
	launchable: boolean;
}

async function defaultReadModelInfo(absPath: string): Promise<ModelRead> {
	const header = await parseGgufFile(absPath);
	return { info: extractModelInfo(header), fileSize: statSync(absPath).size };
}

/**
 * Pidfile ownership check that never mutates: unlike `inspectOrphan` (which
 * clears stale pidfiles), doctor only observes — inspecting must not change
 * config/presets/state.
 */
async function defaultInspectProcess(
	pidFile: string,
): Promise<ProcessInspection> {
	const record = readPidFile(pidFile);
	if (!record) return { status: "none", pid: null };
	const observed = defaultProcessInspector().inspect(record.pid);
	if (observed === "dead") return { status: "stale", pid: record.pid };
	if (observed === "unknown" || typeof observed === "string") {
		return { status: "unknown", pid: record.pid };
	}
	if (!isLlamaServerCommand(observed.command)) {
		return { status: "stale", pid: record.pid };
	}
	return { status: "alive", pid: record.pid };
}

/** Mirror presetToPlan's model-path resolution for doctor's own fs checks. */
function absolutizeModelPath(modelPath: string): string {
	if (isAbsolute(modelPath)) return modelPath;
	if (modelPath.startsWith("./") || modelPath.startsWith("../")) {
		return resolve(modelPath);
	}
	return modelPath;
}

function finiteNumber(v: unknown): number | null {
	return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function kvQuantOf(effective: Record<string, unknown>, id: string): KvQuant {
	const v = effective[id];
	return v === "q8_0" || v === "q4_0" || v === "f16" ? v : "f16";
}

export async function buildDoctorReport(
	target: DoctorTarget,
	paths: DoctorPaths,
	deps: DoctorDeps = {},
): Promise<DoctorReport> {
	const now = deps.now ?? (() => new Date().toISOString());
	const fileExists = deps.fileExists ?? existsSync;
	const probeBinary = deps.probeBinary ?? probeBinaryAvailability;
	const readModelInfo = deps.readModelInfo ?? defaultReadModelInfo;
	const detectHardware =
		deps.detectHardware ??
		((configDir: string) => getOrDetectHardware(configDir));
	const inspectProcess = deps.inspectProcess ?? defaultInspectProcess;
	const splitCheck = deps.splitCheck ?? splitIncompleteReason;

	const { preset } = target;
	const blockers: string[] = [];
	const warnings: string[] = [];

	// Binary resolution + runtime --help capability probe (§7, Issue #19).
	const probe = await probeBinary(preset.binary_path);
	const binaryPath = probe.resolvedPath;
	if (!binaryPath) {
		blockers.push(
			"llama-server binary not found (checked configured binary_path and PATH)",
		);
	}
	if (binaryPath && !probe.verified) {
		warnings.push(
			"binary --help probe failed; runtime flag compatibility is unverified",
		);
	}
	const availability = probe.availability;

	// Model: existence, split-group completeness, GGUF metadata.
	const absModel = absolutizeModelPath(preset.model_path);
	const modelExists = fileExists(absModel);
	if (!modelExists) {
		blockers.push(`model file not found: ${absModel}`);
	}
	const incompleteSplit = modelExists ? splitCheck(absModel) : null;
	if (incompleteSplit) blockers.push(incompleteSplit);
	let modelRead: ModelRead | null = null;
	if (modelExists) {
		try {
			modelRead = await readModelInfo(absModel);
		} catch {
			warnings.push(
				`model metadata unreadable (${absModel}); VRAM estimate skipped`,
			);
		}
	}

	// Effective flags after defaults + validation, then the exact argv via
	// the same builder `start` uses — diagnostics cannot drift from runtime.
	const meta = { blockCount: modelRead?.info.blockCount };
	const sanitized = sanitizeValues(preset.flags, meta);
	const effective = sanitized.clamped;
	const plan = presetToPlan(preset, { availability });

	const droppedUnsupported: string[] = [];
	for (const id of Object.keys(effective)) {
		const avail = availability[id];
		if (avail && !avail.supported) {
			droppedUnsupported.push(id);
			const token = getFlag(id)?.cli[1] ?? getFlag(id)?.cli[0] ?? id;
			warnings.push(
				`flag "${id}" (${token}) not supported by this binary — dropped from argv`,
			);
		}
	}
	for (const issue of sanitized.issues) {
		warnings.push(`flag "${issue.id}": ${issue.message}`);
	}

	// VRAM estimate (range + limitations, never a single number).
	const info = modelRead?.info ?? null;
	const hasEstimatorMetadata =
		!!info &&
		info.blockCount !== undefined &&
		info.headCount !== undefined &&
		info.headCountKv !== undefined &&
		info.embeddingLength !== undefined;
	let estimate: DoctorReport["estimate"] = null;
	if (modelRead && hasEstimatorMetadata) {
		const est = estimateVram({
			fileSize: modelRead.fileSize,
			blockCount: info.blockCount as number,
			contextLength:
				finiteNumber(effective.ctx_size) ??
				info.contextLength ??
				DEFAULT_CONTEXT,
			headCount: info.headCount as number,
			headCountKv: info.headCountKv as number,
			embeddingLength: info.embeddingLength as number,
			keyLength: info.keyLength,
			gpuLayers: finiteNumber(effective.n_gpu_layers) ?? 0,
			kvQuantK: kvQuantOf(effective, "cache_type_k"),
			kvQuantV: kvQuantOf(effective, "cache_type_v"),
		});
		const hardware = await detectHardware(paths.configDir).catch(() => null);
		estimate = {
			vramRangeBytes: { low: est.range.low, high: est.range.high },
			limitations: est.limitations,
			hardware: hardware
				? {
						kind: hardware.kind,
						vramBytes: hardware.vramBytes,
						totalMemBytes: hardware.totalMemBytes,
					}
				: null,
		};
	} else if (modelExists && modelRead) {
		warnings.push("incomplete model metadata for VRAM estimation");
	}

	// Telemetry endpoint follows the plan (P4-FR-11 auto-inject).
	const telemetryEnabled = plan.args.includes("--metrics");
	const host = plan.host ?? DEFAULT_HOST;
	const telemetry = {
		enabled: telemetryEnabled,
		endpoint: `http://${host}:${plan.port}`,
	};

	// Process ownership: exactly one managed instance (D4).
	const process = await inspectProcess(paths.pidFile);
	if (process.status === "alive") {
		blockers.push(
			`a managed server is already running (pid=${process.pid}) — stop it first: llama-deck kill`,
		);
	} else if (process.status === "stale") {
		warnings.push(
			`stale pidfile for dead pid=${process.pid} (left untouched by doctor)`,
		);
	} else if (process.status === "unknown") {
		warnings.push(
			`process identity for pid=${process.pid} unavailable — ownership uncertain`,
		);
	}

	if (host === "0.0.0.0") {
		warnings.push("host 0.0.0.0 binds all interfaces");
	}

	return {
		schema: DOCTOR_SCHEMA,
		generatedAt: now(),
		target: { kind: "preset", id: preset.id, name: preset.name },
		binary: {
			status: binaryPath ? "ok" : "missing",
			path: binaryPath,
			helpVerified: probe.verified,
			probedFlags: Object.keys(availability).length,
		},
		model: {
			path: absModel,
			exists: modelExists,
			metadata: info,
			incompleteSplit,
		},
		flags: {
			effective,
			issues: sanitized.issues,
			droppedUnsupported,
		},
		plan: {
			command: plan.command,
			args: plan.args,
			commandLine: commandLine({ command: plan.command, args: plan.args }),
			host,
			port: plan.port,
		},
		estimate,
		telemetry,
		process,
		blockers,
		warnings,
		launchable: blockers.length === 0,
	};
}

/** Human-readable rendering of a doctor report (no UI imports — D5). */
export function formatDoctorReport(r: DoctorReport): string {
	const lines: string[] = [];
	const targetName =
		r.target.kind === "preset"
			? `preset "${r.target.name}" (${r.target.id})`
			: r.target.path;
	lines.push(`doctor: ${targetName}`);
	lines.push(
		`  binary:    ${r.binary.status === "ok" ? r.binary.path : "MISSING"}` +
			(r.binary.helpVerified ? " (--help verified)" : " (--help unverified)"),
	);
	const meta = r.model.metadata;
	lines.push(
		`  model:     ${r.model.path}` +
			(meta
				? ` (${meta.architecture ?? "?"}, ${meta.quantName}, ${(meta.totalParams / 1e9).toFixed(1)}B params)`
				: " (no metadata)") +
			(r.model.incompleteSplit ? ` — ${r.model.incompleteSplit}` : ""),
	);
	lines.push(`  plan:      ${r.plan.commandLine}`);
	if (r.estimate) {
		const gib = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GiB`;
		lines.push(
			`  estimate:  VRAM ${gib(r.estimate.vramRangeBytes.low)}–${gib(r.estimate.vramRangeBytes.high)}` +
				(r.estimate.limitations.length > 0
					? ` (limitations: ${r.estimate.limitations.map((l) => l.code).join(", ")})`
					: ""),
		);
	} else {
		lines.push("  estimate:  unavailable");
	}
	lines.push(
		`  telemetry: ${r.telemetry.enabled ? `enabled → ${r.telemetry.endpoint}/metrics` : "disabled"}`,
	);
	lines.push(
		`  process:   ${r.process.status === "none" ? "no managed server running" : `${r.process.status} (pid=${r.process.pid})`}`,
	);
	if (r.blockers.length > 0) {
		lines.push(`  BLOCKERS (${r.blockers.length}):`);
		for (const b of r.blockers) lines.push(`    - ${b}`);
	}
	if (r.warnings.length > 0) {
		lines.push(`  warnings (${r.warnings.length}):`);
		for (const w of r.warnings) lines.push(`    - ${w}`);
	}
	lines.push(`  verdict:   ${r.launchable ? "LAUNCHABLE" : "NOT LAUNCHABLE"}`);
	return lines.join("\n");
}
