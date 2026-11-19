#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { formatBytes } from "./core/estimate/vram";
import { probeBinaryAvailability } from "./core/flags/validate";
import { splitIncompleteReason } from "./core/models/launch-guard";
import { scanModels } from "./core/models/scanner";
import type { ModelEntry } from "./core/models/types";
import { type ExportFormat, exportPreset } from "./core/preset-launch";
import { inspectOrphan, killOrphan } from "./core/process/orphan";
import {
	CONFIG_KEYS,
	configKeyField,
	consolidateLegacyConfig,
	expandPath,
	loadEffectiveConfig,
	normalizeConfigKey,
	setConfigValue,
} from "./core/store/config";
import { clearPidFile } from "./core/store/pidfile";
import {
	deletePresetFromFile,
	loadPresets,
	type PresetFile,
	presetsFilePath,
	renamePresetInFile,
	savePresets,
	setDefaultPresetInFile,
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
  llama-deck presets delete <preset>
                              Delete a saved preset
  llama-deck presets rename <preset> <new name>
                              Rename a saved preset (id stays stable)
  llama-deck presets set-default <preset>
                              Set the preset restored on boot (lastSession)
  llama-deck config get [key] [--json]
                              Print an app setting and its source; keys:
                              binary-path, models-dir, theme (no key = all).
                              Settings live in config.json (#69)
  llama-deck config set <key> <value>
                              Persist an app setting to config.json
  llama-deck tui              Launch the interactive TUI (same as the
                              package's TUI entry; bare llama-deck
                              with no command prints this help)
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

const SUBCOMMAND_HELP: Record<string, string> = {
	quick: `Usage: llama-deck quick <model.gguf> [--run] [--json] [--binary <path>]\n  Resolve or run the optimal launch command for a model.`,
	scan: `Usage: llama-deck scan [dir ...] [--json]\n  Scan directories (default: configured models dir).`,
	list: `Usage: llama-deck list [dir ...] [--json]\n  List model names only.`,
	presets: `Usage: llama-deck presets [--json]\n       llama-deck presets delete <preset>\n       llama-deck presets rename <preset> <new name>\n       llama-deck presets set-default <preset>\n  List saved presets, or delete / rename / set-default one.`,
	config: `Usage: llama-deck config get [key] [--json]\n       llama-deck config set <key> <value>\n  Keys: binary-path, models-dir, theme. Settings live in config.json (#69);\n  get prints the effective value and its source (config.json,\n  presets.json (legacy), or unset).`,
	tui: `Usage: llama-deck tui\n  Launch the interactive TUI.`,
	export: `Usage: llama-deck export <preset> [--format cmd|sh|systemd|json]\n  Export a preset's launch command, or the preset itself as portable JSON.`,
	import: `Usage: llama-deck import <file|-> [--name <name>] [--save]\n  Import a shell command into a preset or preview; a preset JSON\n  document imports directly.`,
	start: `Usage: llama-deck start <preset>\n  Launch a preset (llama-server in foreground).`,
	doctor: `Usage: llama-deck doctor <preset> [--json]\n  Diagnose launch readiness without starting a server\n  (exit 0 when launchable, 1 otherwise).`,
	kill: `Usage: llama-deck kill [--json]\n  Stop a running instance via pidfile (§6.2).`,
	help: HELP,
};

function subcommandUsage(command: string): never {
	console.log(SUBCOMMAND_HELP[command] ?? HELP);
	process.exit(0);
}

/** True when the invocation asks for help anywhere (`-h`/`--help`/`help`). */
function wantsHelp(args: string[]): boolean {
	return args.includes("--help") || args.includes("-h") || args[0] === "help";
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

/**
 * `llama-deck config get|set` (#69): config.json is the owner of app
 * settings. `get` prints the effective value and its source; `set`
 * persists through the atomic config store (migrating legacy fields
 * first so a set never leaves a shadowing duplicate behind).
 */
function handleConfig(args: string[], configDir: string): void {
	const { rest, json } = jsonFlag(args);
	const action = rest[0];
	if (action === undefined || action === "get") {
		const eff = loadEffectiveConfig(configDir);
		const keys = action === "get" && rest[1] ? [rest[1]] : [...CONFIG_KEYS];
		const normalized: string[] = [];
		for (const raw of keys) {
			const key = normalizeConfigKey(raw ?? "");
			if (!key) {
				usageError(
					`Unknown config key: ${raw} (expected one of: ${CONFIG_KEYS.join(", ")})`,
					json,
				);
			}
			normalized.push(key as string);
		}
		if (json) {
			const out: Record<string, { value: string | null; source: string }> = {};
			for (const key of normalized) {
				const field = configKeyField(key as never);
				const value = eff.config[field] as string | undefined;
				out[key as string] = {
					value: value ?? null,
					source: eff.sources[key as never],
				};
			}
			console.log(
				JSON.stringify(
					action === "get" && rest[1] ? out[normalized[0] as string] : out,
				),
			);
			return;
		}
		for (const key of normalized) {
			const field = configKeyField(key as never);
			const value = eff.config[field] as string | undefined;
			console.log(
				`${key}: ${value ?? "(unset)"} (source: ${eff.sources[key as never]})`,
			);
		}
		return;
	}
	if (action === "set") {
		const rawKey = rest[1];
		const value = rest.slice(2).join(" ");
		if (!rawKey || rest.length < 3) {
			usageError(
				"Usage: llama-deck config set <key> <value> (keys: binary-path, models-dir, theme)",
				json,
			);
		}
		const key = normalizeConfigKey(rawKey as string);
		if (!key) {
			usageError(
				`Unknown config key: ${rawKey} (expected one of: ${CONFIG_KEYS.join(", ")})`,
				json,
			);
		}
		try {
			consolidateLegacyConfig(configDir);
		} catch {}
		const next = setConfigValue(configDir, key as never, value);
		const field = configKeyField(key as never);
		const saved = next[field] as string | undefined;
		if (json) {
			console.log(
				JSON.stringify({ key, value: saved ?? null, source: "config.json" }),
			);
		} else {
			console.log(`${key}: ${saved ?? "(unset)"} (source: config.json)`);
		}
		return;
	}
	usageError(`Unknown config action: ${action} (expected get or set)`, json);
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
	const modelsDir = loadEffectiveConfig(paths.configDir).config.modelsDir;
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
	// Bare invocation prints help (exit 0) — the TUI is `llama-deck tui`.
	if (!command) usage();
	if (command === "-h" || command === "--help") usage();
	if (command === "help") {
		if (args[0] && SUBCOMMAND_HELP[args[0]]) subcommandUsage(args[0]);
		usage();
	}
	// `<subcommand> --help` / `-h` / `help` prints help and exits 0 — it is
	// never a preset/model name (audit CLI polish).
	if (SUBCOMMAND_HELP[command] && wantsHelp(args)) {
		subcommandUsage(command);
	}
	if (!SUBCOMMAND_HELP[command] && command !== "scan" && command !== "list") {
		// Unknown commands are handled at the end of main for scan/list
		// fallthrough parity; help flags on unknown commands still exit 0.
		if (wantsHelp(args)) usage();
	}

	const paths = resolvePaths();

	// #69: one-time forward migration of legacy presets.json settings into
	// config.json. `config get` is exempt so it can report the true legacy
	// source; every other command migrates before reading settings.
	const isConfigGet =
		command === "config" && (args[0] === "get" || args.length === 0);
	if (command !== "tui" && command !== "kill" && !isConfigGet) {
		try {
			consolidateLegacyConfig(paths.configDir);
		} catch {
			// Migration is best-effort at the CLI edge; effective-config
			// reads still fall back to the legacy fields.
		}
	}

	if (command === "tui") {
		const { dirname, join } = await import("node:path");
		const { fileURLToPath } = await import("node:url");
		const mainPath = join(dirname(fileURLToPath(import.meta.url)), "main.tsx");
		const proc = Bun.spawn([process.execPath, mainPath], {
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
			env: process.env,
		});
		process.exit(await proc.exited);
	}

	if (command === "config") {
		handleConfig(args, paths.configDir);
		return;
	}

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
		const sub = rest[0];
		// Preset management parity (#69): delete / rename / set-default.
		if (sub === "delete" || sub === "remove") {
			const id = rest[1];
			if (!id) {
				usageError(
					"Missing preset. Usage: llama-deck presets delete <preset>",
					json,
				);
			}
			const store = loadPresetsWarned();
			const file = (store.data as PresetFile | null) ?? {
				version: 2,
				presets: [],
			};
			const { file: next, removed } = deletePresetFromFile(file, id as string);
			if (!removed) {
				const message = `Unknown preset: ${id} (see: llama-deck presets)`;
				console.error(json ? JSON.stringify({ error: message }) : message);
				process.exit(1);
			}
			savePresets(presetsFilePath(paths.configDir), next);
			console.log(
				json
					? JSON.stringify({ deleted: removed.id, name: removed.name })
					: `Deleted preset "${removed.name}" (${removed.id})`,
			);
			return;
		}
		if (sub === "rename") {
			const id = rest[1];
			const newName = rest.slice(2).join(" ");
			if (!id || !newName) {
				usageError(
					"Usage: llama-deck presets rename <preset> <new name>",
					json,
				);
			}
			const store = loadPresetsWarned();
			const file = (store.data as PresetFile | null) ?? {
				version: 2,
				presets: [],
			};
			const { file: next, renamed } = renamePresetInFile(
				file,
				id as string,
				newName,
			);
			if (!renamed) {
				const message = `Unknown preset: ${id} (see: llama-deck presets)`;
				console.error(json ? JSON.stringify({ error: message }) : message);
				process.exit(1);
			}
			savePresets(presetsFilePath(paths.configDir), next);
			console.log(
				json
					? JSON.stringify({ id: renamed.id, name: renamed.name })
					: `Renamed preset (${renamed.id}) to "${renamed.name}"`,
			);
			return;
		}
		if (sub === "set-default" || sub === "default") {
			const id = rest[1];
			if (!id) {
				usageError(
					"Missing preset. Usage: llama-deck presets set-default <preset>",
					json,
				);
			}
			const store = loadPresetsWarned();
			const file = (store.data as PresetFile | null) ?? {
				version: 2,
				presets: [],
			};
			const { file: next, preset } = setDefaultPresetInFile(file, id as string);
			if (!preset) {
				const message = `Unknown preset: ${id} (see: llama-deck presets)`;
				console.error(json ? JSON.stringify({ error: message }) : message);
				process.exit(1);
			}
			savePresets(presetsFilePath(paths.configDir), next);
			console.log(
				json
					? JSON.stringify({ default: preset.id, name: preset.name })
					: `Default preset: "${preset.name}" (${preset.id})`,
			);
			return;
		}
		if (sub !== undefined && sub !== "list") {
			usageError(
				`Unknown presets action: ${sub} (expected list, delete, rename, set-default)`,
				json,
			);
		}
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

/**
 * Configured binary path (#69): config.json `binaryPath` is the owner,
 * read through the effective-config fallback so a not-yet-migrated
 * presets.json `binary_path` still works. (Per-preset `binary_path`
 * launch overrides are separate and handled in preset-launch/doctor.)
 */
function configuredBinary(): string | undefined {
	return loadEffectiveConfig(resolvePaths().configDir).config.binaryPath;
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
