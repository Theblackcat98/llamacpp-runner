/**
 * Estimator calibration (#12): ground-truth loop for the VRAM formula.
 * At run end, when telemetry saw mem_used_bytes, a run entry
 * {presetId, estimatedBytes, actualBytes, ts} is recorded into a bounded,
 * per-preset history under $XDG_STATE_HOME/llama-deck (atomic writes, §5)
 * from which a mean(est/actual) drift factor is computed — per preset or
 * per model architecture via an injected preset->arch mapping.
 *
 * PURE history math + atomic persistence only; pollers/UI wiring stays
 * with the callers (ui consumption is a follow-up issue).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWrite } from "../store/atomic";

export const CALIBRATION_VERSION = 1;

/** Maximum retained entries per preset; older entries are pruned (§5). */
export const CALIBRATION_HISTORY_PER_PRESET = 20;

export interface CalibrationEntry {
	presetId: string;
	estimatedBytes: number;
	actualBytes: number;
	ts: string;
}

export interface CalibrationFile {
	version: typeof CALIBRATION_VERSION;
	entries: CalibrationEntry[];
}

export interface CalibrationSaveOptions {
	writeFn?: (path: string, data: string) => void;
	renameFn?: (from: string, to: string) => void;
}

export function emptyCalibration(): CalibrationFile {
	return { version: CALIBRATION_VERSION, entries: [] };
}

export function calibrationFilePath(stateDir: string): string {
	return join(stateDir, "calibration.json");
}

/**
 * Append a run entry and prune each preset's history to the newest
 * CALIBRATION_HISTORY_PER_PRESET entries. Pure: returns a new file.
 */
export function recordCalibrationRun(
	file: CalibrationFile,
	entry: CalibrationEntry,
): CalibrationFile {
	const byPreset = new Map<string, CalibrationEntry[]>();
	const merged = [...file.entries, entry];
	for (const e of merged) {
		const list = byPreset.get(e.presetId) ?? [];
		list.push(e);
		byPreset.set(e.presetId, list);
	}
	const entries: CalibrationEntry[] = [];
	for (const list of byPreset.values()) {
		entries.push(...list.slice(-CALIBRATION_HISTORY_PER_PRESET));
	}
	return { version: CALIBRATION_VERSION, entries };
}

/** Tolerant load: missing/corrupt/future-version files read as empty (D1). */
export function loadCalibration(filePath: string): CalibrationFile {
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(filePath, "utf8"));
	} catch {
		return emptyCalibration();
	}
	if (typeof raw !== "object" || raw === null) return emptyCalibration();
	const doc = raw as Record<string, unknown>;
	if (doc.version !== CALIBRATION_VERSION) return emptyCalibration();
	const entries = doc.entries;
	if (!Array.isArray(entries)) return emptyCalibration();
	const valid = entries.filter((e): e is CalibrationEntry => {
		if (typeof e !== "object" || e === null) return false;
		const c = e as Record<string, unknown>;
		return (
			typeof c.presetId === "string" &&
			typeof c.estimatedBytes === "number" &&
			typeof c.actualBytes === "number" &&
			typeof c.ts === "string"
		);
	});
	return { version: CALIBRATION_VERSION, entries: valid };
}

/** Persist via the shared atomic write convention (temp + rename, §5). */
export function saveCalibration(
	filePath: string,
	file: CalibrationFile,
	opts: CalibrationSaveOptions = {},
): void {
	atomicWrite(filePath, JSON.stringify(file, null, "\t"), {
		writeFile: opts.writeFn,
		rename: opts.renameFn,
	});
}

/**
 * Mean(est/actual) over entries with positive estimate and actual.
 * Returns null when no valid samples exist — never a false zero.
 */
export function driftFactor(entries: CalibrationEntry[]): number | null {
	const factors: number[] = [];
	for (const e of entries) {
		if (e.estimatedBytes > 0 && e.actualBytes > 0) {
			factors.push(e.estimatedBytes / e.actualBytes);
		}
	}
	if (factors.length === 0) return null;
	return factors.reduce((sum, f) => sum + f, 0) / factors.length;
}

export function driftForPreset(
	file: CalibrationFile,
	presetId: string,
): number | null {
	return driftFactor(file.entries.filter((e) => e.presetId === presetId));
}

/**
 * Drift factor grouped by model architecture via an injected
 * presetId -> architecture mapping. Presets the mapping cannot classify
 * contribute to the "*" bucket so no ground truth is silently dropped.
 */
export function driftByArchitecture(
	file: CalibrationFile,
	archOf: (presetId: string) => string | null | undefined,
): Record<string, number> {
	const groups = new Map<string, CalibrationEntry[]>();
	for (const e of file.entries) {
		const arch = archOf(e.presetId) ?? "*";
		const list = groups.get(arch) ?? [];
		list.push(e);
		groups.set(arch, list);
	}
	const out: Record<string, number> = {};
	for (const [arch, list] of groups) {
		const factor = driftFactor(list);
		if (factor !== null) out[arch] = factor;
	}
	return out;
}

/**
 * One-shot run-end recorder (#12): call at teardown when telemetry was
 * active. Records only when BOTH the estimate and a metrics peak exist —
 * "if metrics were seen". Returns whether an entry was written.
 */
export function recordRunCalibration(opts: {
	filePath: string;
	presetId: string;
	estimatedBytes: number | null | undefined;
	peakMemUsedBytes: number | null | undefined;
	ts?: string;
	save?: CalibrationSaveOptions;
}): boolean {
	if (
		opts.peakMemUsedBytes === null ||
		opts.peakMemUsedBytes === undefined ||
		opts.peakMemUsedBytes <= 0 ||
		opts.estimatedBytes === null ||
		opts.estimatedBytes === undefined ||
		opts.estimatedBytes <= 0
	) {
		return false;
	}
	const file = recordCalibrationRun(loadCalibration(opts.filePath), {
		presetId: opts.presetId,
		estimatedBytes: opts.estimatedBytes,
		actualBytes: opts.peakMemUsedBytes,
		ts: opts.ts ?? new Date().toISOString(),
	});
	saveCalibration(opts.filePath, file, opts.save);
	return true;
}
