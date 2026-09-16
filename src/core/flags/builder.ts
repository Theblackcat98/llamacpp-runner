/**
 * Command builder (§3.3, P4-FR-03): (registry + model metadata + user values)
 * -> deterministic argv. Pure — same inputs produce byte-identical argv
 * (P4-NFR-01). meta: max refs resolve against the selected model.
 */
import { LLAMA_SERVER_BIN } from "../constants";
import { shellQuote } from "../export/quote";
import type { FlagAvailability } from "./help-parser";
import { FLAG_ORDER, type FlagEntry, REGISTRY } from "./registry";

export interface ModelMeta {
	blockCount?: number;
}

export interface BuildCommandInput {
	modelPath: string;
	meta?: ModelMeta;
	/** User values keyed by registry flag id; unknown ids are ignored here. */
	values: Record<string, unknown>;
	/**
	 * P4-FR-11: --slots/--metrics pair auto-injected while telemetry enabled
	 * (default ON); explicit values win.
	 */
	telemetry?: boolean;
	/**
	 * Phase 12: runtime `--help` availability map; flags the binary does not
	 * support are dropped from argv so they can never launch accidentally.
	 */
	availability?: Record<string, FlagAvailability>;
}

export interface BuiltCommand {
	command: string;
	args: string[];
}

function resolveMax(
	entry: { max?: number | string },
	meta: ModelMeta,
): number | null {
	if (typeof entry.max !== "string") return entry.max ?? null;
	if (!entry.max.startsWith("meta:")) return null;
	if (entry.max === "meta:block_count+1") {
		return meta.blockCount === undefined ? null : meta.blockCount + 1;
	}
	return null;
}

export function buildCommand(input: BuildCommandInput): BuiltCommand {
	const meta = input.meta ?? {};
	const values = input.values;
	const args: string[] = ["-m", input.modelPath];
	const has = (id: string) => {
		const v = values[id];
		return (
			v !== undefined &&
			v !== null &&
			v !== false &&
			(typeof v !== "string" || v.length > 0)
		);
	};
	// An explicitly-present value (even false) overrides telemetry injection.
	const explicit = (id: string) =>
		id in values && values[id] !== undefined && values[id] !== null;

	// Phase 12: flags the binary does not support are dropped before emission.
	const availability = input.availability;
	const isSupported = (id: string): boolean => {
		if (availability === undefined) return true;
		const avail = availability[id];
		if (!avail) return true; // unknown -> don't guess, keep
		return avail.supported;
	};

	for (const id of FLAG_ORDER) {
		if (!has(id)) continue;
		const entry: FlagEntry = REGISTRY[id];
		const raw: unknown = values[id];
		if (!isSupported(id)) continue;

		if (entry.type === "bool") {
			// Bools use their long form for readability in preview/exports.
			args.push(entry.cli[1] ?? entry.cli[0]);
			continue;
		}
		if (entry.type === "enum") {
			const str = String(raw);
			if (!entry.options?.includes(str)) continue;
			args.push(entry.cli[0], str);
			continue;
		}
		if (entry.type === "int") {
			const n =
				typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
			if (!Number.isFinite(n)) continue;
			const max = resolveMax(entry, meta);
			const clamped = Math.min(
				Math.max(Math.trunc(n), entry.min ?? -Infinity),
				max ?? Infinity,
			);
			args.push(entry.cli[0], String(clamped));
			continue;
		}
		args.push(entry.cli[0], String(raw));
	}

	const telemetry = input.telemetry ?? true;
	if (telemetry && !explicit("slots") && isSupported("slots")) {
		args.push("--slots");
	}
	if (telemetry && !explicit("metrics") && isSupported("metrics")) {
		args.push("--metrics");
	}

	return { command: LLAMA_SERVER_BIN, args };
}

/**
 * Shell-quote a full command line for preview / .sh export (POSIX). Delegate
 * to the shared formatter so previews and exports never drift (Phase 12).
 */
export function commandLine(built: BuiltCommand): string {
	return [built.command, ...built.args.map(shellQuote)].join(" ");
}
