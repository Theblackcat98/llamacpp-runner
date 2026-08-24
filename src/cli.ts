import { formatBytes } from "./core/estimate/vram";
import { scanModels } from "./core/models/scanner";
import type { ModelEntry } from "./core/models/types";
import { type ExportFormat, exportPreset } from "./core/preset-launch";
import { loadConfig } from "./core/store/config";
import {
	loadPresets,
	type PresetFile,
	presetsFilePath,
} from "./core/store/presets";
import { resolvePaths } from "./core/store/state-paths";

function usage(): never {
	console.log(`llama-deck — llama.cpp manager

Usage:
  llama-deck scan [dir ...]   Scan directories (default: configured models dir)
  llama-deck list [dir ...]   List model names only
  llama-deck presets          List saved presets
  llama-deck export <preset> [--format cmd|sh|systemd]
                              Export a preset's launch command
  llama-deck start <preset>   Launch a preset (llama-server in foreground)
`);
	process.exit(0);
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

	if (command === "presets") {
		const store = loadPresets(presetsFilePath(paths.configDir));
		const file = store.data as PresetFile | null;
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
		process.stdout.write(exportPreset(findPreset(presetId), format));
		return;
	}

	if (command === "start") {
		const presetId = args[0];
		if (!presetId) usage();
		const { presetToPlan } = await import("./core/preset-launch");
		const plan = presetToPlan(findPreset(presetId));
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
		console.log(`Unknown command: ${command} (kill arrives in Phase 5)`);
		usage();
	}

	const dirs = resolveDirs(args);
	const state = resolvePaths();
	const result = await scanModels(dirs, { stateDir: state.stateDir });

	if (command === "list") {
		for (const entry of result.entries) console.log(entry.name);
		return;
	}

	console.log(
		`Scanned ${result.stats.filesWalked} files in ${dirs.join(", ")} -> ${result.entries.length} models`,
	);
	console.table(formatRows(result.entries));
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
