/**
 * Hand-edited value validation & clamping (Phase 12, §3.3): presets and
 * configurator text inputs accept arbitrary numbers/strings, so before a
 * command is generated we clamp out-of-range numeric flags and reject values
 * that can never produce a valid launch. Pure and deterministic.
 */
import { type FlagEntry, getFlag } from "./registry";

export interface ValueIssue {
	id: string;
	message: string;
}

/** Flags whose raw value cannot be turned into a valid CLI token. */
export interface ValidationResult {
	/** Problem values (for UI surfacing). */
	issues: ValueIssue[];
	/** Values with numeric ranges clamped to the registry's valid range. */
	clamped: Record<string, unknown>;
}

/**
 * Resolve `max` refs against model metadata the same way the builder does.
 */
export interface MetaContext {
	blockCount?: number;
}

function resolveMax(
	entry: FlagEntry,
	meta: MetaContext | undefined,
): number | null {
	const max = entry.max;
	if (typeof max !== "number") {
		if (entry.max === "meta:block_count+1") {
			return meta?.blockCount === undefined ? null : meta.blockCount + 1;
		}
		return null;
	}
	return max;
}

/**
 * Clamp / validate hand-edited values before command generation. Returns a
 * copy of values with numeric changes applied and a list of issues for UI.
 */
export function sanitizeValues(
	values: Record<string, unknown>,
	meta?: MetaContext,
): ValidationResult {
	const clamped: Record<string, unknown> = { ...values };
	const issues: ValueIssue[] = [];

	for (const [id, raw] of Object.entries(values)) {
		const entry = getFlag(id);
		if (!entry) continue;

		if (entry.type === "int") {
			const n =
				typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
			if (!Number.isFinite(n)) {
				issues.push({
					id,
					message: `expected an integer, got "${String(raw)}"`,
				});
				continue;
			}
			const max = resolveMax(entry, meta);
			const lo = entry.min ?? -Infinity;
			const hi = max ?? Infinity;
			const out = Math.trunc(n);
			if (out < lo || out > hi) {
				clamped[id] = Math.min(Math.max(out, lo), hi);
				issues.push({
					id,
					message: `clamped to ${String(clamped[id])} (valid ${lo === -Infinity ? "-∞" : lo}..${hi === Infinity ? "∞" : hi})`,
				});
			}
			continue;
		}

		if (entry.type === "enum") {
			const str = String(raw);
			if (!entry.options?.includes(str)) {
				issues.push({
					id,
					message: `"${str}" is not a valid choice (${entry.options?.join(", ")})`,
				});
			}
		}
	}

	return { issues, clamped };
}

/**
 * A command may still build even when issues exist (we clamp ints; the typo'd
 * enum is simply skipped by the builder). `sanitizeValues` gives the caller
 * the surface to decide whether to block entirely.
 */
export function hasHardErrors(result: ValidationResult): boolean {
	return result.issues.some(
		(i) => i.message.startsWith("expected") || !i.message.startsWith("clamped"),
	);
}
