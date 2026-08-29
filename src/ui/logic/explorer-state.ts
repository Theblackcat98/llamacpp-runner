import { estimateVram, formatBytes } from "../../core/estimate/vram";
import type { ModelEntry } from "../../core/models/types";

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

export function buildRows(entries: ModelEntry[]): ExplorerRow[] {
	return entries.map((entry) => {
		const corrupt = Boolean(entry.error);
		const incomplete = Boolean(entry.incomplete);
		const name = entry.name;
		return {
			displayName: corrupt
				? `${CORRUPT_GLYPH} ${name}`
				: incomplete
					? `~ ${name}`
					: name,
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

export const CORRUPT_GLYPH = "!";
