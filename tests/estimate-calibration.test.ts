import { afterAll, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	CALIBRATION_HISTORY_PER_PRESET,
	type CalibrationEntry,
	driftByArchitecture,
	driftFactor,
	driftForPreset,
	loadCalibration,
	recordCalibrationRun,
	recordRunCalibration,
	saveCalibration,
} from "../src/core/estimate/calibration";

const DIR = join(process.cwd(), ".tmp", "estimate-calibration-test");

function entry(over: Partial<CalibrationEntry> = {}): CalibrationEntry {
	return {
		presetId: "preset-a",
		estimatedBytes: 6_500_000_000,
		actualBytes: 5_900_000_000,
		ts: "2026-09-15T10:00:00.000Z",
		...over,
	};
}

afterAll(() => {
	rmSync(DIR, { recursive: true, force: true });
});

describe("calibration history (#12)", () => {
	it("appends a run entry", () => {
		let file = loadCalibration(join(DIR, "none.json"));
		file = recordCalibrationRun(file, entry());
		expect(file.entries).toHaveLength(1);
		expect(file.entries[0]?.presetId).toBe("preset-a");
		expect(file.entries[0]?.actualBytes).toBe(5_900_000_000);
	});

	it("bounds history to the last N entries per preset", () => {
		let file = loadCalibration(join(DIR, "none.json"));
		for (let i = 0; i < CALIBRATION_HISTORY_PER_PRESET + 5; i++) {
			file = recordCalibrationRun(file, entry({ ts: `t${i}` }));
		}
		expect(file.entries).toHaveLength(CALIBRATION_HISTORY_PER_PRESET);
		expect(file.entries[0]?.ts).toBe("t5");
		expect(file.entries[file.entries.length - 1]?.ts).toBe(
			`t${CALIBRATION_HISTORY_PER_PRESET + 4}`,
		);
	});

	it("prunes per preset without touching other presets", () => {
		let file = loadCalibration(join(DIR, "none.json"));
		for (let i = 0; i < CALIBRATION_HISTORY_PER_PRESET + 2; i++) {
			file = recordCalibrationRun(file, entry({ presetId: "a", ts: `a${i}` }));
		}
		file = recordCalibrationRun(file, entry({ presetId: "b", ts: "b0" }));
		expect(file.entries.filter((e) => e.presetId === "a")).toHaveLength(
			CALIBRATION_HISTORY_PER_PRESET,
		);
		expect(file.entries.filter((e) => e.presetId === "b")).toHaveLength(1);
		expect(file.entries[0]?.presetId).toBe("a");
		expect(file.entries[0]?.ts).toBe("a2");
	});
});

describe("calibration persistence (#12)", () => {
	it("uses the atomic write path (temp + rename), never a direct write", () => {
		mkdirSync(DIR, { recursive: true });
		const target = join(DIR, "calibration.json");
		const writes: string[] = [];
		const renames: [string, string][] = [];
		saveCalibration(
			target,
			{ version: 1, entries: [entry()] },
			{
				writeFn: (path, data) => {
					writes.push(path);
					writes.push(data);
				},
				renameFn: (from, to) => renames.push([from, to]),
			},
		);
		expect(writes[0]).not.toBe(target);
		expect(writes[0]).toContain(".tmp-");
		const tempPath = writes[0] as string;
		expect(renames).toEqual([[tempPath, target]]);
	});

	it("round-trips through disk and tolerates missing/corrupt files", () => {
		mkdirSync(DIR, { recursive: true });
		const target = join(DIR, "roundtrip.json");
		saveCalibration(target, { version: 1, entries: [entry()] });
		expect(loadCalibration(target).entries).toHaveLength(1);
		expect(loadCalibration(join(DIR, "missing.json")).entries).toEqual([]);

		const corrupt = join(DIR, "corrupt.json");
		saveCalibration(corrupt, { version: 1, entries: [entry()] });
		appendCorrupt(corrupt);
		expect(loadCalibration(corrupt).entries).toEqual([]);
	});

	it("rejects unknown future versions (D1 forward-only)", () => {
		mkdirSync(DIR, { recursive: true });
		const target = join(DIR, "future.json");
		writeFileSync(target, JSON.stringify({ version: 99, entries: [entry()] }));
		const loaded = loadCalibration(target);
		expect(loaded.entries).toEqual([]);
		expect(loaded.version).toBe(1);
	});
});

describe("drift math (#12)", () => {
	it("computes mean(est/actual) on synthetic histories", () => {
		const entries = [
			entry({ estimatedBytes: 6_000_000_000, actualBytes: 6_000_000_000 }),
			entry({ estimatedBytes: 6_600_000_000, actualBytes: 6_000_000_000 }),
		];
		expect(driftFactor(entries)).toBeCloseTo(1.05, 5);
	});

	it("returns null without valid samples", () => {
		expect(driftFactor([])).toBeNull();
		expect(driftFactor([entry({ actualBytes: 0 })])).toBeNull();
		expect(driftFactor([entry({ estimatedBytes: 0 })])).toBeNull();
	});

	it("driftForPreset filters by preset id", () => {
		const file = {
			version: 1 as const,
			entries: [
				entry({ estimatedBytes: 6_000_000_000, actualBytes: 6_000_000_000 }),
				entry({
					presetId: "preset-b",
					estimatedBytes: 4_000_000_000,
					actualBytes: 8_000_000_000,
				}),
			],
		};
		expect(driftForPreset(file, "preset-b")).toBeCloseTo(0.5, 5);
		expect(driftForPreset(file, "preset-a")).toBeCloseTo(1, 5);
		expect(driftForPreset(file, "preset-zzz")).toBeNull();
	});

	it("driftByArchitecture groups via the injected preset->arch mapping", () => {
		const file = {
			version: 1 as const,
			entries: [
				entry({
					presetId: "qwen-x",
					estimatedBytes: 5_000_000_000,
					actualBytes: 5_000_000_000,
				}),
				entry({
					presetId: "qwen-y",
					estimatedBytes: 6_000_000_000,
					actualBytes: 4_000_000_000,
				}),
				entry({
					presetId: "llama-z",
					estimatedBytes: 3_000_000_000,
					actualBytes: 6_000_000_000,
				}),
				entry({
					presetId: "mystery",
					estimatedBytes: 2_000_000_000,
					actualBytes: 2_000_000_000,
				}),
			],
		};
		const archOf = (id: string) =>
			id.startsWith("qwen") ? "qwen2" : id.startsWith("llama") ? "llama" : null;
		const drift = driftByArchitecture(file, archOf);
		expect(drift.qwen2).toBeCloseTo(1.25, 5);
		expect(drift.llama).toBeCloseTo(0.5, 5);
		expect(drift["*"]).toBeCloseTo(1, 5);
	});
});

describe("recordRunCalibration (#12)", () => {
	it("records nothing when no metrics were seen", () => {
		mkdirSync(DIR, { recursive: true });
		const target = join(DIR, "run-no-metrics.json");
		const recorded = recordRunCalibration({
			filePath: target,
			presetId: "preset-a",
			estimatedBytes: 6_000_000_000,
			peakMemUsedBytes: null,
		});
		expect(recorded).toBe(false);
		expect(existsSync(target)).toBe(false);
	});

	it("records nothing when no estimate is available", () => {
		mkdirSync(DIR, { recursive: true });
		const target = join(DIR, "run-no-estimate.json");
		const recorded = recordRunCalibration({
			filePath: target,
			presetId: "preset-a",
			estimatedBytes: null,
			peakMemUsedBytes: 1_000_000,
		});
		expect(recorded).toBe(false);
		expect(existsSync(target)).toBe(false);
	});

	it("records the run and persists atomically", () => {
		mkdirSync(DIR, { recursive: true });
		const target = join(DIR, "run.json");
		const recorded = recordRunCalibration({
			filePath: target,
			presetId: "preset-a",
			estimatedBytes: 6_000_000_000,
			peakMemUsedBytes: 5_500_000_000,
			ts: "2026-09-15T11:00:00.000Z",
		});
		expect(recorded).toBe(true);
		const loaded = loadCalibration(target);
		expect(loaded.entries).toHaveLength(1);
		expect(loaded.entries[0]?.estimatedBytes).toBe(6_000_000_000);
		expect(loaded.entries[0]?.actualBytes).toBe(5_500_000_000);
		expect(loaded.entries[0]?.ts).toBe("2026-09-15T11:00:00.000Z");
	});

	it("appends across runs without unbounded growth", () => {
		mkdirSync(DIR, { recursive: true });
		const target = join(DIR, "growth.json");
		for (let i = 0; i < CALIBRATION_HISTORY_PER_PRESET + 3; i++) {
			recordRunCalibration({
				filePath: target,
				presetId: "preset-a",
				estimatedBytes: 6_000_000_000,
				peakMemUsedBytes: 5_000_000_000 + i,
				ts: `2026-09-15T12:${String(i).padStart(2, "0")}:00.000Z`,
			});
		}
		const onDisk = JSON.parse(readFileSync(target, "utf8")) as {
			entries: CalibrationEntry[];
		};
		expect(onDisk.entries).toHaveLength(CALIBRATION_HISTORY_PER_PRESET);
	});
});

function appendCorrupt(path: string): void {
	writeFileSync(path, "{broken");
}
