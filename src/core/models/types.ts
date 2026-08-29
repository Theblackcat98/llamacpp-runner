/** One row in the Explorer table (P3-FR-15). */
export interface ModelEntry {
	/** Display name: split-group base name or plain file name. */
	name: string;
	/** Primary file (split part 1 when grouped). */
	path: string;
	/** All files backing this row (one for standalone models). */
	paths: string[];
	totalBytes: number;
	architecture?: string;
	quantName: string;
	contextLength?: number;
	blockCount?: number;
	embeddingLength?: number;
	headCount?: number;
	headCountKv?: number;
	keyLength?: number;
	totalParams?: number;
	effectiveBpw?: number;
	/** Split group missing siblings (§7). */
	incomplete?: boolean;
	/** Parse failure reason; row renders with parse-error glyph (P3-FR-16). */
	error?: string;
}

export interface ScanResult {
	entries: ModelEntry[];
	stats: { filesWalked: number; parsed: number; cachedHits: number };
	errors?: string[];
}
