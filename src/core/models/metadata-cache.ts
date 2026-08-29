import { readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWrite } from "../store/atomic";
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
export function loadCache(stateDir: string): MetadataCache {
	try {
		const raw = JSON.parse(
			readFileSync(cacheFilePath(stateDir), "utf8"),
		) as MetadataCache;
		if (raw.version === CACHE_VERSION && raw.entries) return raw;
	} catch {
		/* cold start */
	}
	return { version: CACHE_VERSION, entries: {} };
}
export function cacheGet(
	cache: MetadataCache,
	path: string,
	signature: string,
): ModelEntry | undefined {
	const hit = cache.entries[path];
	return hit?.signature === signature ? hit.entry : undefined;
}
export function cachePut(
	cache: MetadataCache,
	path: string,
	signature: string,
	entry: ModelEntry,
): void {
	cache.entries[path] = { signature, entry };
}
export function saveCache(stateDir: string, cache: MetadataCache): void {
	atomicWrite(cacheFilePath(stateDir), JSON.stringify(cache));
}
export function dropStale(cache: MetadataCache, livePaths: Set<string>): void {
	for (const path of Object.keys(cache.entries))
		if (!livePaths.has(path)) delete cache.entries[path];
}
