import { formatBytes } from "./core/estimate/vram";
import { registryAvailability } from "./core/flags/help-parser";
import { captureHelp, resolveBinaryPath } from "./core/flags/validate";
import { scanModels } from "./core/models/scanner";
import type { ModelEntry } from "./core/models/types";
import { type ExportFormat, exportPreset } from "./core/preset-launch";
import { inspectOrphan, killOrphan } from "./core/process/orphan";
import { loadConfig } from "./core/store/config";
import { clearPidFile } from "./core/store/pidfile";
import {
	loadPresets,
	type PresetFile,
	presetsFilePath,
} from "./core/store/presets";
import { resolvePaths } from "./core/store/state-paths";

function usage(): never {
	console.log(`llama-deck — llama.cpp manager

Usage:
  llama-deck scan [dir ...] [--json]
                              Scan directories (default: configured models dir)
  llama-deck list [dir ...] [--json]
                              List model names only
  llama-deck presets [--json] List saved presets
  llama-deck export <preset> [--format cmd|sh|systemd]
                              Export a preset's launch command
  llama-deck start <preset>   Launch a preset (llama-server in foreground)
  llama-deck kill [--json]    Stop a running instance via pidfile (§6.2)
`);
	process.exit(0);
}

/** P5-FR-13: --json output modes for scripting. */
function jsonFlag(args: string[]): { rest: string[]; json: boolean } {
	const json = args.includes("--json");
	return { rest: args.filter((a) => a !== "--json"), json };
}

function findPreset(id: string): import("./core/store/presets").Preset {
	const found = findPresetById(id);
	if (!found) {
		console.error(`Unknown preset: ${id} (see: llama-deck presets)`);
		process.exit(1);
	}
	return found;
}

function findPresetById(
	id: string,
): import("./core/store/presets").Preset | null {
	const paths = resolvePaths();
	const store = loadPresets(presetsFilePath(paths.configDir));
	const file = store.data as PresetFile | null;
	return file?.presets.find((p) => p.id === id || p.name === id) ?? null;
}

function resolveDirs(args: string[]): string[] {
	if (args.length > 0) return args;
	const paths = resolvePaths();
	const modelsDir = loadConfig(paths.configDir).modelsDir;
	if (!modelsDir) {
		console.error(
			"No model directory set. Pass one: llama-deck scan ~/models/llm",
		);
		process.exit(1);
	}
	return [modelsDir];
}

async function main(): Promise<void> {
	const [, , command, ...args] = process.argv;
	if (!command || command === "help" || command === "--help") usage();

	const paths = resolvePaths();

	if (command === "kill") {
		const { json } = jsonFlag(args);
		const inspection = await inspectOrphan(paths.pidFile);
		const out = (payload: {
			killed: boolean;
			pid?: number;
			reason?: string;
		}) =>
			json
				? console.log(JSON.stringify(payload))
				: console.log(
						payload.killed
							? `killed llama-server pid=${payload.pid}`
							: payload.reason === "alive"
								? "failed to kill"
								: payload.reason === "stale"
									? "stale pidfile cleaned — no server running"
									: "no server running",
					);
		if (inspection.status === "alive" && inspection.record) {
			const killed = await killOrphan(inspection.record.pid);
			if (!killed) clearPidFile(paths.pidFile);
			out({ killed, pid: inspection.record.pid, reason: "alive" });
			process.exit(killed ? 0 : 1);
		}
		out({
			killed: false,
			reason: inspection.status === "stale" ? "stale" : "no_pidfile",
		});
		return;
	}

	if (command === "presets") {
		const { rest, json } = jsonFlag(args);
		void rest;
		const store = loadPresets(presetsFilePath(paths.configDir));
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
		if (!presetId) usage();
		const formatIdx = args.indexOf("--format");
		const format = (
			formatIdx >= 0 ? args[formatIdx + 1] : "cmd"
		) as ExportFormat;
		if (format !== "cmd" && format !== "sh" && format !== "systemd") usage();
		const preset = findPreset(presetId);
		const availability = await runtimeAvailability(configuredBinary());
		process.stdout.write(exportPreset(preset, format, { availability }));
		return;
	}

	if (command === "start") {
		const presetId = args[0];
		if (!presetId) usage();
		const { presetToPlan } = await import("./core/preset-launch");
		const preset = findPreset(presetId);
		const availability = await runtimeAvailability(configuredBinary());
		const plan = presetToPlan(preset, { availability });
		const child = Bun.spawn([plan.command, ...plan.args], {
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
			env: { ...process.env, ...plan.env },
		});
		process.on("SIGINT", () => child.kill("SIGINT"));
		await child.exited;
		process.exit(child.exitCode ?? 0);
	}

	if (command !== "scan" && command !== "list") {
		console.log(`Unknown command: ${command}`);
		usage();
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
	const store = loadPresets(presetsFilePath(resolvePaths().configDir));
	return (store.data as PresetFile | null)?.binary_path ?? undefined;
}

/**
 * Phase 12: resolve the binary, capture its `--help`, and compute the flag
 * availability map so unsupported flags never launch. Best effort — any
 * capture failure yields {} (builder keeps every flag).
 */
async function runtimeAvailability(
	binaryPath: string | undefined,
): Promise<Record<string, { supported: boolean; deprecated: boolean }>> {
	const binary =
		resolveBinaryPath({ configured: binaryPath }).status === "ok"
			? binaryPath
			: undefined;
	const help = binary ? await captureHelp(binary) : "";
	return help ? registryAvailability(help) : {};
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

main();
