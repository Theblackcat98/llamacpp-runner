/**
 * Launch guard for split artifacts (#18): discovery knows a split group is
 * incomplete (`ModelEntry.incomplete`, §7), and selection/launch must
 * preserve that state — an incomplete multi-part model is not a runnable
 * artifact. Pure checks; recovery = add the missing parts, then rescan.
 */
import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
	groupSplitFiles,
	isGroupComplete,
	type SplitCandidate,
} from "./split-grouping";
import type { ModelEntry } from "./types";

/**
 * Blocking reason for launching `entry`, or null when it may proceed.
 * Parse errors keep their existing block; incomplete split groups are
 * rejected with recovery guidance.
 */
export function entryLaunchBlocker(
	entry: ModelEntry | undefined,
): string | null {
	if (!entry) return "no model selected";
	if (entry.error) return `parse error: ${entry.error}`;
	if (entry.incomplete) {
		return `incomplete split group "${entry.name}" — add the missing parts and rescan`;
	}
	return null;
}

/**
 * Filesystem-level twin of `entryLaunchBlocker` for path-only callers
 * (CLI `start`/`quick`, preset model paths): resolves the split sibling
 * group from the directory and reports what is missing. Non-split paths
 * and missing files are not this guard's concern (null).
 */
export function splitIncompleteReason(modelPath: string): string | null {
	const name = basename(modelPath);
	const base = groupSplitFiles([{ name, path: modelPath }])
		.keys()
		.next().value as string | undefined;
	if (!base) return null;
	let dirEntries: string[];
	try {
		dirEntries = readdirSync(dirname(modelPath));
	} catch {
		return null;
	}
	const candidates: SplitCandidate[] = [];
	for (const entry of dirEntries) {
		if (!entry.toLowerCase().endsWith(".gguf")) continue;
		const fullPath = join(dirname(modelPath), entry);
		if (!existsSync(fullPath)) continue;
		candidates.push({ name: entry, path: fullPath });
	}
	const parts = groupSplitFiles(candidates).get(base) ?? [];
	if (isGroupComplete(parts)) return null;
	const total = name.match(/-(\d{5})\.gguf$/)?.[1];
	const have = parts.length;
	const totalNum = total ? Number.parseInt(total, 10) : 0;
	return `incomplete split group "${base}" — have ${have} of ${totalNum} parts`;
}
