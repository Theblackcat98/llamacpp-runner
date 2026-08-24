import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelEntry } from "./types";

const CACHE_VERSION = 1;

interface CacheEntry {
	signature: string;
	entry: ModelEntry;
}

export interface MetadataCache {
	version: number;
	entries: Record<string, CacheEntry>;
}

export function cacheFilePath(stateDir: string): string {
	return join(stateDir, "models-cache.json");
}

/**
 * P3-FR-10: persisted in $XDG_STATE_HOME/llama-deck/; warm scans skip parsing
 * while the signature (path set + size + mtime per file) is unchanged.
 */
export function loadCache(stateDir: string): MetadataCache {
	try {
		const raw = JSON.parse(
			readFileSync(cacheFilePath(stateDir), "utf8"),
		) as MetadataCache;
		if (raw.version === CACHE_VERSION && raw.entries) return raw;
	} catch {
		// missing/corrupt cache -> cold start
	}
	return { version: CACHE_VERSION, entries: {} };
}

export function cacheGet(
	cache: MetadataCache,
	path: string,
	signature: string,
): ModelEntry | undefined {
	const hit = cache.entries[path];
	if (!hit || hit.signature !== signature) return undefined;
	return hit.entry;
}

export function cachePut(
	cache: MetadataCache,
	path: string,
	signature: string,
	entry: ModelEntry,
): void {
	cache.entries[path] = { signature, entry };
}

/** Atomic write: temp file + rename (D1). */
export function saveCache(stateDir: string, cache: MetadataCache): void {
	mkdirSync(stateDir, { recursive: true });
	const finalPath = cacheFilePath(stateDir);
	const tmpPath = `${finalPath}.tmp`;
	writeFileSync(tmpPath, JSON.stringify(cache));
	renameSync(tmpPath, finalPath);
}

export function dropStale(cache: MetadataCache, livePaths: Set<string>): void {
	for (const path of Object.keys(cache.entries)) {
		if (!livePaths.has(path)) delete cache.entries[path];
	}
}
