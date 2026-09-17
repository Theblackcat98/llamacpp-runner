import { existsSync } from "node:fs";
import { formatBytes } from "./core/estimate/vram";
import { probeBinaryAvailability } from "./core/flags/validate";
import { splitIncompleteReason } from "./core/models/launch-guard";
import { scanModels } from "./core/models/scanner";
import type { ModelEntry } from "./core/models/types";
import { type ExportFormat, exportPreset } from "./core/preset-launch";
import { inspectOrphan, killOrphan } from "./core/process/orphan";
import { expandPath, loadConfig } from "./core/store/config";
import { clearPidFile } from "./core/store/pidfile";
import {
	loadPresets,
	type PresetFile,
	presetsFilePath,
} from "./core/store/presets";
import { resolvePaths } from "./core/store/state-paths";

const HELP = `llama-deck — llama.cpp manager

Usage:
  llama-deck quick <model.gguf> [--run] [--json] [--binary <path>]
                              Resolve or run optimal command for model
  llama-deck scan [dir ...] [--json]
                              Scan directories (default: configured models dir)
  llama-deck list [dir ...] [--json]
                              List model names only
  llama-deck presets [--json] List saved presets
  llama-deck export <preset> [--format cmd|sh|systemd|json]
                              Export a preset's launch command, or the
                              preset itself as portable JSON
  llama-deck import <file|-> [--name <name>] [--save]
                              Import shell command into preset or preview;
                              a preset JSON document imports directly
  llama-deck start <preset>   Launch a preset (llama-server in foreground)
  llama-deck doctor <preset> [--json]
                              Diagnose launch readiness without starting a
                              server (exit 0 when launchable, 1 otherwise)
  llama-deck kill [--json]    Stop a running instance via pidfile (§6.2)

Exit codes:
  0  success
  1  runtime failure (missing file, unknown preset, launch blocked)
  2  usage error (unknown command, missing argument, invalid flag value)
`;

function usage(): never {
	console.log(HELP);
	process.exit(0);
}

/** #20: malformed invocations are failures for scripts — exit 2, not 0. */
function usageError(message: string, json = false): never {
	console.error(json ? JSON.stringify({ error: message }) : message);
	process.exit(2);
}

/** P5-FR-13: --json output modes for scripting. */
function jsonFlag(args: string[]): { rest: string[]; json: boolean } {
	const json = args.includes("--json");
	return { rest: args.filter((a) => a !== "--json"), json };
}

function findPreset(
	id: string,
	json = false,
): import("./core/store/presets").Preset {
	const found = findPresetById(id);
	if (!found) {
		const message = `Unknown preset: ${id} (see: llama-deck presets)`;
		console.error(json ? JSON.stringify({ error: message }) : message);
		process.exit(1);
	}
	return found;
}

/**
 * #59: the loader preserves a corrupt presets.json as .corrupt-<ts>; the
 * CLI surfaces that loudly on stderr instead of silently showing nothing.
 */
function loadPresetsWarned(): ReturnType<typeof loadPresets> {
	const store = loadPresets(presetsFilePath(resolvePaths().configDir));
	if (store.corruptBackup) {
		console.error(
			`[ERR] presets.json was unreadable — original preserved at ${store.corruptBackup}`,
		);
	}
	return store;
}

function findPresetById(
	id: string,
): import("./core/store/presets").Preset | null {
	const store = loadPresetsWarned();
	const file = store.data as PresetFile | null;
	return file?.presets.find((p) => p.id === id || p.name === id) ?? null;
}

function resolveDirs(args: string[]): string[] {
	if (args.length > 0) return args.map(expandPath);
	const paths = resolvePaths();
	const modelsDir = loadConfig(paths.configDir).modelsDir;
	if (!modelsDir) {
		console.error(
			"No model directory set. Pass one: llama-deck scan ~/models/llm",
		);
		process.exit(1);
	}
	return [expandPath(modelsDir)];
}

/**
 * #61: pure kill-outcome mapping so every inspection status reports
 * honestly — "unknown" (identity unavailable: macOS, permission failures)
 * is NOT "no server running" and exits non-zero.
 */
export function killOutcome(
	status: string,
	killed: boolean,
	pid?: number,
): { reason: string; message: string; exitCode: number } {
	if (killed) {
		return {
			reason: "alive",
			message: `killed llama-server pid=${pid}`,
			exitCode: 0,
		};
	}
	switch (status) {
		case "alive":
			return { reason: "alive", message: "failed to kill", exitCode: 1 };
		case "unknown":
			return {
				reason: "unknown",
				message:
					"cannot verify server state (process identity unavailable) — kill skipped",
				exitCode: 1,
			};
		case "stale":
			return {
				reason: "stale",
				message: "stale pidfile cleaned — no server running",
				exitCode: 0,
			};
		default:
			return {
				reason: "no_pidfile",
				message: "no server running",
				exitCode: 0,
			};
	}
}

async function main(): Promise<void> {
	const [, , command, ...args] = process.argv;
	if (!command || command === "help" || command === "--help") usage();

	const paths = resolvePaths();

	if (command === "kill") {
		const { json } = jsonFlag(args);
		const inspection = await inspectOrphan(paths.pidFile);
		if (inspection.status === "alive" && inspection.record) {
			const killed = await killOrphan(inspection.record.pid);
			if (!killed) clearPidFile(paths.pidFile);
			const out = killOutcome(inspection.status, killed, inspection.record.pid);
			if (json) {
				console.log(
					JSON.stringify({
						killed,
						pid: inspection.record.pid,
						reason: out.reason,
					}),
				);
			} else {
				console.log(out.message);
			}
			process.exit(out.exitCode);
		}
		const out = killOutcome(inspection.status, false);
		if (json) {
			console.log(JSON.stringify({ killed: false, reason: out.reason }));
		} else {
			console.log(out.message);
		}
		process.exit(out.exitCode);
	}

	if (command === "presets") {
		const { rest, json } = jsonFlag(args);
		void rest;
		const store = loadPresetsWarned();
		const file = store.data as PresetFile | null;
		if (json) {
			console.log(JSON.stringify(file?.presets ?? []));
			return;
		}
		for (const p of file?.presets ?? []) {
			console.log(`${p.id}\t${p.name}`);
		}
		return;
	}

	if (command === "export") {
		const presetId = args[0];
		if (!presetId)
			usageError(
				"Missing preset. Usage: llama-deck export <preset> [--format cmd|sh|systemd|json]",
			);
		const formatIdx = args.indexOf("--format");
		const formatRaw = formatIdx >= 0 ? args[formatIdx + 1] : "cmd";
		if (
			formatRaw !== "cmd" &&
			formatRaw !== "sh" &&
			formatRaw !== "systemd" &&
			formatRaw !== "json"
		)
			usageError(
				`Invalid --format: ${formatRaw} (expected cmd, sh, systemd, json)`,
			);
		const preset = findPreset(presetId);
		// #11: portable single-preset JSON — no binary probe needed.
		if (formatRaw === "json") {
			const { exportPresetDoc } = await import(
				"./core/store/preset-portability"
			);
			console.log(JSON.stringify(exportPresetDoc(preset), null, "\t"));
			return;
		}
		const availability = await runtimeAvailability(configuredBinary());
		process.stdout.write(
			exportPreset(preset, formatRaw as ExportFormat, { availability }),
		);
		return;
	}

	if (command === "doctor") {
		const { rest, json } = jsonFlag(args);
		const presetId = rest[0];
		if (!presetId) {
			usageError(
				"Missing preset. Usage: llama-deck doctor <preset> [--json]",
				json,
			);
		}
		const preset = findPreset(presetId, json);
		const { buildDoctorReport, formatDoctorReport } = await import(
			"./core/doctor"
		);
		const { probeBinaryAvailability } = await import("./core/flags/validate");
		// Same resolution `start` uses: per-preset binary_path, else the
		// file-level configured binary, else PATH.
		const configured =
			(preset as { binary_path?: string }).binary_path ?? configuredBinary();
		const report = await buildDoctorReport(
			{ preset },
			{
				configDir: paths.configDir,
				stateDir: paths.stateDir,
				pidFile: paths.pidFile,
			},
			{
				probeBinary: () => probeBinaryAvailability({ configured }),
			},
		);
		if (json) {
			console.log(JSON.stringify(report));
		} else {
			console.log(formatDoctorReport(report));
		}
		// Machine-readable verdict for scripting: 0 = launchable.
		process.exit(report.launchable ? 0 : 1);
	}

	if (command === "import") {
		const target = args[0];
		if (!target)
			usageError(
				"Missing file. Usage: llama-deck import <file|-> [--name <name>] [--save]",
			);
		let content = "";
		if (target === "-") {
			content = await Bun.stdin.text();
		} else {
			content = await Bun.file(target).text();
		}

		// #11 door 1: a preset-document JSON (exported preset) merges into
		// the store directly; door 2 (below) is the shell-command tokenizer.
		// Anything that LOOKS like JSON but is invalid is rejected instead of
		// silently becoming a shell import.
		if (content.trimStart().startsWith("{")) {
			const { importPresetsInto, parsePresetDoc } = await import(
				"./core/store/preset-portability"
			);
			const { savePresets } = await import("./core/store/presets");
			const { emptyPresetFile } = await import("./core/store/presets");
			const parsed = parsePresetDoc(content);
			if (!parsed.ok) {
				console.error(`Import failed: ${parsed.error}`);
				process.exit(1);
			}
			const store = loadPresetsWarned();
			const current = store.data ?? emptyPresetFile();
			const { doc: merged, imported } = importPresetsInto(current, parsed.doc);
			savePresets(presetsFilePath(paths.configDir), merged);
			for (const entry of imported) {
				if (entry.renamedId) {
					console.log(
						`Imported preset "${entry.preset.name}" (${entry.originalId}) — id already in use, renamed to ${entry.preset.id}`,
					);
				} else {
					console.log(
						`Imported preset "${entry.preset.name}" (${entry.preset.id})`,
					);
				}
			}
			return;
		}

		const { parseShellCommand } = await import("./core/import/shell");
		const imported = parseShellCommand(content);

		const nameIdx = args.indexOf("--name");
		const specifiedName = nameIdx >= 0 ? args[nameIdx + 1] : undefined;
		const presetName =
			specifiedName && specifiedName.length > 0
				? specifiedName
				: `Imported (${new Date().toISOString().slice(0, 10)})`;

		const shouldSave = args.includes("--save");
		const presetId = `preset-${Date.now()}`;
		const preset: import("./core/store/presets").Preset = {
			id: presetId,
			name: presetName,
			model_path: imported.modelPath,
			flags: imported.values,
			env_vars: imported.envVars,
			created_at: new Date().toISOString(),
			last_used: null,
		};

		if (shouldSave) {
			const store = loadPresetsWarned();
			const file = (store.data as PresetFile | null) ?? {
				version: 2,
				presets: [],
			};
			file.presets.push(preset);
			const { savePresets } = await import("./core/store/presets");
			savePresets(presetsFilePath(paths.configDir), file);
			console.log(`Saved preset "${presetName}" (${presetId})`);
		} else {
			console.log(JSON.stringify(preset, null, 2));
		}
		return;
	}

	if (command === "start") {
		const presetId = args[0];
		if (!presetId)
			usageError("Missing preset. Usage: llama-deck start <preset>");
		const { presetToPlan } = await import("./core/preset-launch");
		// Exactly one managed instance (D4): refuse a second start while the
		// pidfile points at a live server — same guard as the TUI path.
		const inspection = await inspectOrphan(paths.pidFile);
		if (inspection.status === "alive") {
			console.error(
				`A managed server is already running (pid=${inspection.record?.pid ?? "?"}). Stop it first: llama-deck kill`,
			);
			process.exit(1);
		}
		const preset = findPreset(presetId);
		// #18: an incomplete split group is not a runnable artifact.
		const splitBlocker = splitIncompleteReason(preset.model_path);
		if (splitBlocker) {
			console.error(`Refusing to launch: ${splitBlocker}`);
			process.exit(1);
		}
		const availability = await runtimeAvailability(configuredBinary());
		const plan = presetToPlan(preset, { availability });
		// Shared Supervisor lifecycle (§6.2, Issue #13): pidfile ownership,
		// SIGINT → wait ≤5 s → SIGKILL escalation, deterministic cleanup.
		// No ad-hoc spawn — one process-lifecycle implementation.
		const { runQuickSupervisor } = await import("./core/quick");
		const code = await runQuickSupervisor(plan, {
			pidFile: paths.pidFile,
			onLog: (line) => console.log(line),
		});
		process.exit(code);
	}

	if (command === "quick") {
		const { rest, json } = jsonFlag(args);
		const run = rest.includes("--run");
		const filtered = rest.filter((a) => a !== "--run");
		const binaryIdx = filtered.indexOf("--binary");
		let binaryPath: string | undefined;
		let modelArgs = filtered;
		if (binaryIdx >= 0) {
			binaryPath = filtered[binaryIdx + 1];
			modelArgs = filtered.filter(
				(_, i) => i !== binaryIdx && i !== binaryIdx + 1,
			);
		}
		const rawModelPath = modelArgs[0];
		if (!rawModelPath) {
			usageError(
				"Missing model file. Usage: llama-deck quick <model.gguf> [--run] [--json]",
				json,
			);
		}

		const modelPath = expandPath(rawModelPath);
		if (!existsSync(modelPath)) {
			console.error(`Model file not found: ${modelPath}`);
			process.exit(1);
		}

		const resolvedBinary = binaryPath || configuredBinary();
		const { resolveQuick, runQuickSupervisor } = await import("./core/quick");
		const result = await resolveQuick(modelPath, {
			configDir: paths.configDir,
			binaryPath: resolvedBinary,
		});

		if (run) {
			// #18: never spawn from an incomplete split group.
			const splitBlocker = splitIncompleteReason(modelPath);
			if (splitBlocker) {
				console.error(`Refusing to launch: ${splitBlocker}`);
				process.exit(1);
			}
			const code = await runQuickSupervisor(result.plan, {
				pidFile: paths.pidFile,
				onLog: (line) => console.log(line),
			});
			process.exit(code);
		}

		if (json) {
			console.log(
				JSON.stringify({
					plan: result.plan,
					estimate: result.estimate,
				}),
			);
			return;
		}

		if (result.conservativeFallback) {
			console.log(
				`Note: ${result.fallbackReason ?? "Hardware detection unavailable; falling back to conservative defaults (n_gpu_layers=0)"}`,
			);
		}
		const { commandLine } = await import("./core/flags/builder");
		console.log(commandLine(result.plan));
		return;
	}

	if (command !== "scan" && command !== "list") {
		usageError(
			`Unknown command: ${command} (see: llama-deck help)`,
			jsonFlag(args).json,
		);
	}

	const { rest, json } = jsonFlag(args);
	const dirs = resolveDirs(rest);
	const state = resolvePaths();
	const result = await scanModels(dirs, { stateDir: state.stateDir });

	if (command === "list") {
		if (json) {
			console.log(
				JSON.stringify(
					result.entries.map((e) => ({
						name: e.name,
						sizeBytes: e.totalBytes,
						quant: e.quantName,
						arch: e.architecture,
					})),
				),
			);
			return;
		}
		for (const entry of result.entries) console.log(entry.name);
		return;
	}

	if (json) {
		console.log(
			JSON.stringify({
				dirs,
				stats: result.stats,
				entries: formatRows(result.entries),
			}),
		);
		return;
	}

	console.log(
		`Scanned ${result.stats.filesWalked} files in ${dirs.join(", ")} -> ${result.entries.length} models`,
	);
	console.table(formatRows(result.entries));
}

/** Configured binary_path from the presets file (file-level, Phase 8). */
function configuredBinary(): string | undefined {
	const store = loadPresetsWarned();
	return (store.data as PresetFile | null)?.binary_path ?? undefined;
}

/**
 * Phase 12 (Issue #19): probe the RESOLVED binary path for `--help` and
 * compute the flag availability map so unsupported flags never launch.
 * Best effort — any capture failure yields {} (builder keeps every flag),
 * and the binary is left unverified rather than falsely validated.
 */
async function runtimeAvailability(
	binaryPath: string | undefined,
): Promise<Record<string, { supported: boolean; deprecated: boolean }>> {
	const probed = await probeBinaryAvailability({ configured: binaryPath });
	return probed.availability;
}

function formatRows(entries: ModelEntry[]): Record<string, string>[] {
	return entries.map((e) => ({
		name: e.name,
		size: e.error ? "-" : formatBytes(e.totalBytes),
		quant: e.quantName ?? "-",
		arch: e.architecture ?? "-",
		params: e.totalParams ? `${(e.totalParams / 1e9).toFixed(2)}B` : "-",
		flags: [
			e.incomplete ? "incomplete" : null,
			e.error ? `error: ${e.error}` : null,
		]
			.filter(Boolean)
			.join(" "),
	}));
}

if (import.meta.main) {
	void main();
}
