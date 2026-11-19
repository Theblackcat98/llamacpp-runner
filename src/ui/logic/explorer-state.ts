import { estimateVram, formatBytes } from "../../core/estimate/vram";
import type { ModelEntry } from "../../core/models/types";
import { type IconSet, iconFor } from "../glyphs";
import { fuzzyScore } from "./palette-state";

export interface ExplorerViewModel {
	rows: ExplorerRow[];
}

export interface ExplorerRow {
	/** Decorated display name (parse-error glyph prefix when corrupt). */
	displayName: string;
	name: string;
	sizeLabel: string;
	quantLabel: string;
	archLabel: string;
	/** True when the row should render the parse-error glyph (P3-FR-16). */
	corrupt: boolean;
	/** True when split-group siblings are missing (§7). */
	incomplete: boolean;
	entry: ModelEntry;
}

export function buildRows(
	entries: ModelEntry[],
	iconSet: IconSet = "ascii",
): ExplorerRow[] {
	return entries.map((entry) => {
		const corrupt = Boolean(entry.error);
		const incomplete = Boolean(entry.incomplete);
		const name = entry.name;
		const icon = corrupt
			? iconFor("file-corrupt", iconSet)
			: incomplete
				? iconFor("file-incomplete", iconSet)
				: iconFor("file-model", iconSet);
		return {
			displayName: icon ? `${icon} ${name}` : name,
			name,
			sizeLabel: corrupt ? "-" : formatBytes(entry.totalBytes),
			quantLabel: entry.quantName ?? "-",
			archLabel: entry.architecture ?? "-",
			corrupt,
			incomplete,
			entry,
		};
	});
}

/**
 * Tier 3: Explorer filter + sort. The view is a pure derivation of the
 * scanned entries — entry object identity is preserved (filter/sort copy
 * the array, never the entries) so selection can track a model by its
 * path across view changes instead of by row index.
 */
export type ExplorerSortMode = "name" | "size" | "context";

export const EXPLORER_SORT_MODES: ExplorerSortMode[] = [
	"name",
	"size",
	"context",
];

export function cycleSortMode(mode: ExplorerSortMode): ExplorerSortMode {
	const i = EXPLORER_SORT_MODES.indexOf(mode);
	return EXPLORER_SORT_MODES[(i + 1) % EXPLORER_SORT_MODES.length] ?? "name";
}

export function sortModeLabel(mode: ExplorerSortMode): string {
	return mode === "name" ? "Name" : mode === "size" ? "Size" : "Context";
}

function compareEntries(
	a: ModelEntry,
	b: ModelEntry,
	mode: ExplorerSortMode,
): number {
	const byName = a.name.localeCompare(b.name, undefined, {
		sensitivity: "base",
	});
	if (mode === "name") return byName;
	if (mode === "size") return b.totalBytes - a.totalBytes || byName;
	// Context: largest first; models without a known context length sort
	// last (an unknown length is not a small length).
	const ac = a.contextLength ?? -1;
	const bc = b.contextLength ?? -1;
	return bc - ac || byName;
}

export function sortEntries(
	entries: ModelEntry[],
	mode: ExplorerSortMode,
): ModelEntry[] {
	return [...entries].sort((a, b) => compareEntries(a, b, mode));
}

/**
 * Fuzzy/substring match on the filename, reusing the palette's scorer:
 * a query matches when its characters appear in order (a contiguous
 * substring is the tightest such match and ranks first).
 */
export function filterEntries(
	entries: ModelEntry[],
	query: string,
): ModelEntry[] {
	const q = query.trim();
	if (q.length === 0) return [...entries];
	return entries.filter((e) => fuzzyScore(e.name, q) !== null);
}

/** The Explorer's visible entries: filtered, then sorted. With a query,
 * fuzzy rank wins (stable sort keeps the sort-mode order among ties). */
export function viewEntries(
	entries: ModelEntry[],
	query: string,
	mode: ExplorerSortMode,
): ModelEntry[] {
	const filtered = filterEntries(entries, query);
	const sorted = sortEntries(filtered, mode);
	const q = query.trim();
	if (q.length === 0) return sorted;
	return sorted.sort(
		(a, b) => (fuzzyScore(a.name, q) ?? 0) - (fuzzyScore(b.name, q) ?? 0),
	);
}

export interface FilterKeyOutcome {
	query: string;
	/** "confirm" keeps the query and exits filter mode; "cancel" (Esc)
	 * clears the query and exits (audit Tier 3). */
	done?: "confirm" | "cancel";
}

/**
 * One keypress while the Explorer filter owns the keyboard. Returns null
 * for keys that are not filter edits (arrows navigate the table; the
 * caller handles them). Printable characters arrive via `sequence`
 * (shifted characters included) or a single-character `name`.
 */
export function applyFilterKey(
	query: string,
	key: { name?: string; sequence?: string; shift?: boolean },
): FilterKeyOutcome | null {
	if (key.name === "escape") return { query: "", done: "cancel" };
	if (key.name === "return" || key.name === "enter")
		return { query, done: "confirm" };
	if (key.name === "backspace") return { query: query.slice(0, -1) };
	if (key.name === "space") return { query: `${query} ` };
	if (key.name === "up" || key.name === "down") return null;
	const ch =
		key.sequence && key.sequence.length === 1 && !/[\p{Cc}]/u.test(key.sequence)
			? key.sequence
			: key.name && key.name.length === 1
				? key.shift
					? key.name.toUpperCase()
					: key.name
				: null;
	if (ch === null) return null;
	return { query: query + ch };
}

export interface InspectorLines {
	lines: Array<{ label: string; value: string; warn?: boolean }>;
	vramRangeLabel?: string;
}

/**
 * Right-pane content for a selected row. VRAM output is ALWAYS labelled
 * "estimated range" (P3-FR-14).
 */
export function inspectorFor(entry: ModelEntry): InspectorLines {
	const lines: InspectorLines["lines"] = [];
	if (entry.error) {
		lines.push({ label: "File", value: entry.name });
		lines.push({ label: "Status", value: "PARSE ERROR", warn: true });
		lines.push({ label: "Reason", value: entry.error, warn: true });
		return { lines };
	}
	lines.push({ label: "File", value: entry.name });
	if (entry.incomplete) {
		lines.push({
			label: "Status",
			value: "INCOMPLETE SPLIT",
			warn: true,
		});
	}
	if (entry.architecture)
		lines.push({ label: "Arch", value: entry.architecture });
	if (entry.contextLength !== undefined) {
		lines.push({
			label: "Context Max",
			value: entry.contextLength.toLocaleString("en-US"),
		});
	}
	if (entry.totalParams !== undefined) {
		lines.push({
			label: "Params (exact)",
			value: `${(entry.totalParams / 1e9).toFixed(2)}B`,
		});
	}
	if (entry.effectiveBpw !== undefined) {
		lines.push({
			label: "Quant",
			value: `${entry.quantName} (~${entry.effectiveBpw.toFixed(1)} bpw)`,
		});
	}
	return { lines };
}

/** Default-config VRAM range for the inspector: full offload, max ctx. */
export function defaultVramRange(
	entry: ModelEntry,
): { low: number; high: number } | null {
	if (
		entry.totalParams === undefined ||
		entry.blockCount === undefined ||
		entry.headCount === undefined ||
		entry.headCountKv === undefined ||
		entry.embeddingLength === undefined
	) {
		return null;
	}
	return estimateVram({
		fileSize: entry.totalBytes,
		blockCount: entry.blockCount,
		contextLength: entry.contextLength ?? 4096,
		headCount: entry.headCount,
		headCountKv: entry.headCountKv,
		keyLength: entry.keyLength,
		embeddingLength: entry.embeddingLength,
		gpuLayers: entry.blockCount + 1,
	}).range;
}
