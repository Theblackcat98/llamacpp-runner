import { formatBytes } from "./core/estimate/vram";
import { scanModels } from "./core/models/scanner";
import type { ModelEntry } from "./core/models/types";
import { loadConfig } from "./core/store/config";
import { resolvePaths } from "./core/store/state-paths";

function usage(): never {
	console.log(`llama-deck — llama.cpp manager

Usage:
  llama-deck scan [dir ...]   Scan directories (default: configured models dir)
  llama-deck list [dir ...]   List model names only
  llama-deck start <preset>   (arrives in Phase 4)
`);
	process.exit(0);
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
	if (command !== "scan" && command !== "list") {
		console.log(
			`Unknown command: ${command} (scan/list arrive now; rest in Phase 5)`,
		);
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
