import { lstatSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ModelInfo } from "../gguf/types";
import {
	cacheGet,
	cachePut,
	dropStale,
	loadCache,
	saveCache,
} from "./metadata-cache";
import type { ParseResponse } from "./scan-worker";
import { groupSplitFiles, isGroupComplete } from "./split-grouping";
import type { ModelEntry, ScanResult } from "./types";

interface WalkedFile {
	path: string;
	size: number;
	mtimeMs: number;
	identity: string;
}

export interface ScanOptions {
	/** Report directories/files that could not be read instead of silently skipping them. */
	onError?: (path: string, error: unknown) => void;
	/**
	 * Follow directory and file symlinks during the walk. Symlink cycles are
	 * detected and skipped; broken links are reported via `errors`/`onError`.
	 * Defaults to false (symlinks are skipped).
	 */
	followSymlinks?: boolean;
	/** $XDG_STATE_HOME/llama-deck — enables the metadata cache (P3-FR-10). */
	stateDir?: string;
	/** Worker pool size (P3-FR-18). Must be a positive integer. Defaults to 4. */
	concurrency?: number;
	/**
	 * Maximum directory recursion depth. Must be a non-negative integer;
	 * 0 walks only the top-level directory. Defaults to DEFAULT_MAX_DEPTH.
	 */
	maxDepth?: number;
}

export const DEFAULT_CONCURRENCY = 4;

/** Default recursion depth for scanModels when ScanOptions.maxDepth is unset. */
export const DEFAULT_MAX_DEPTH = 3;

function walkDirents(dir: string) {
	return readdirSync(dir, { withFileTypes: true });
}

function walk(
	dir: string,
	out: WalkedFile[],
	options: ScanOptions,
	errors: string[],
	depth = 0,
	seen: Set<string> = new Set(),
): void {
	let dirEntries: ReturnType<typeof walkDirents>;
	try {
		dirEntries = walkDirents(dir);
	} catch (error) {
		errors.push(
			`${dir}: ${error instanceof Error ? error.message : String(error)}`,
		);
		options.onError?.(dir, error);
		return;
	}
	if (depth === 0) {
		// Seed symlink-cycle detection with the walk root itself.
		try {
			const st = statSync(dir);
			seen.add(`${st.dev}:${st.ino}`);
		} catch {
			// Ignore: readdir already succeeded, the walk below will surface it.
		}
	}
	const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
	for (const de of dirEntries) {
		const path = join(dir, de.name);
		const isLink = de.isSymbolicLink();
		if (isLink && !options.followSymlinks) continue;

		// Dirent type checks do not follow symlinks, so resolve the target
		// kind explicitly when following links.
		let kind: "dir" | "file" | "other";
		let identity: string | undefined;
		if (!isLink) {
			kind = de.isDirectory() ? "dir" : de.isFile() ? "file" : "other";
		} else {
			let target: ReturnType<typeof statSync>;
			try {
				target = statSync(path);
			} catch (error) {
				errors.push(
					`${path}: ${error instanceof Error ? error.message : String(error)}`,
				);
				options.onError?.(path, error);
				continue;
			}
			kind = target.isDirectory() ? "dir" : target.isFile() ? "file" : "other";
			if (kind === "dir") identity = `${target.dev}:${target.ino}`;
		}

		if (kind === "dir") {
			if (depth < maxDepth) {
				if (!identity) {
					try {
						const st = statSync(path);
						identity = `${st.dev}:${st.ino}`;
					} catch {
						// Ignore: the recursive walk reports unreadable dirs.
					}
				}
				if (identity && seen.has(identity)) continue; // symlink cycle
				walk(
					path,
					out,
					options,
					errors,
					depth + 1,
					identity ? new Set(seen).add(identity) : seen,
				);
			}
			continue;
		}
		if (kind !== "file" || !de.name.toLowerCase().endsWith(".gguf")) continue;
		try {
			const st = statSync(path);
			out.push({
				path,
				size: st.size,
				mtimeMs: st.mtimeMs,
				identity: `${st.dev}:${st.ino}`,
			});
		} catch (error) {
			errors.push(
				`${path}: ${error instanceof Error ? error.message : String(error)}`,
			);
			options.onError?.(path, error);
		}
	}
}

interface Job {
	id: number;
	file: WalkedFile;
}

class ParsePool {
	private workers: Worker[] = [];
	private idle: Worker[] = [];
	private queue: ((worker: Worker) => void)[] = [];

	constructor(size: number) {
		if (!Number.isInteger(size) || size < 1) {
			throw new RangeError(
				`ParsePool: size must be a positive integer, got ${String(size)}`,
			);
		}
		for (let i = 0; i < size; i++) {
			const worker = new Worker(new URL("./scan-worker.ts", import.meta.url));
			this.workers.push(worker);
			this.idle.push(worker);
		}
	}

	run<T>(task: (worker: Worker) => Promise<T>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const start = (worker: Worker): void => {
				task(worker)
					.then(resolve, reject)
					.finally(() => {
						this.idle.push(worker);
						const queued = this.queue.shift();
						const freed = this.idle.pop();
						if (queued && freed) queued(freed);
					});
			};
			const free = this.idle.pop();
			if (free) start(free);
			else this.queue.push(start);
		});
	}

	terminate(): void {
		for (const w of this.workers) w.terminate();
	}
}

function signature(files: WalkedFile[]): string {
	return files
		.map((f) => `${f.path}:${f.size}:${f.mtimeMs}:${f.identity}`)
		.join("|");
}

function baseFileName(path: string): string {
	const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	return idx === -1 ? path : path.slice(idx + 1);
}

/**
 * Recursive scan with split-file grouping, mtime cache and worker-pool
 * parsing (P3-FR-08..10, P3-FR-18). Corrupt rows are flagged, never thrown.
 */
export async function scanModels(
	dirs: string[],
	options: ScanOptions = {},
): Promise<ScanResult> {
	const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
	if (!Number.isInteger(concurrency) || concurrency < 1) {
		throw new RangeError(
			`scanModels: concurrency must be a positive integer, got ${String(options.concurrency)}`,
		);
	}
	const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
	if (!Number.isInteger(maxDepth) || maxDepth < 0) {
		throw new RangeError(
			`scanModels: maxDepth must be a non-negative integer, got ${String(options.maxDepth)}`,
		);
	}

	const walked: WalkedFile[] = [];
	const walkErrors: string[] = [];
	for (const dir of dirs) {
		try {
			if (lstatSync(dir).isSymbolicLink() && !options.followSymlinks) continue;
		} catch (error) {
			walkErrors.push(
				`${dir}: ${error instanceof Error ? error.message : String(error)}`,
			);
			options.onError?.(dir, error);
			continue;
		}
		walk(dir, walked, options, walkErrors);
	}

	const emptyStats = { filesWalked: walked.length, parsed: 0, cachedHits: 0 };
	if (walked.length === 0)
		return { entries: [], stats: emptyStats, errors: walkErrors };

	const cache = options.stateDir ? loadCache(options.stateDir) : undefined;

	// Group split siblings; standalone files are their own row group.
	interface RowGroup {
		files: WalkedFile[];
		baseName: string;
		isSplit: boolean;
	}
	const groups: RowGroup[] = [];
	const claimed = new Set<string>();
	const candidates = walked.map((f) => ({ name: f.path, path: f.path }));
	for (const [base, parts] of groupSplitFiles(candidates)) {
		for (const p of parts) claimed.add(p.name);
		groups.push({
			files: parts
				.map((p) => walked.find((f) => f.path === p.path))
				.filter((f): f is WalkedFile => f !== undefined),
			baseName: baseFileName(base),
			isSplit: true,
		});
	}
	for (const f of walked) {
		if (!claimed.has(f.path)) {
			groups.push({
				files: [f],
				baseName: baseFileName(f.path),
				isSplit: false,
			});
		}
	}

	const entries: ModelEntry[] = [];
	const jobs: Job[] = [];
	let cachedHits = 0;
	const livePaths = new Set<string>();

	for (const group of groups) {
		const primary = group.files[0];
		if (!primary) continue;
		livePaths.add(primary.path);
		const sig = signature(group.files);
		const hit = cache ? cacheGet(cache, primary.path, sig) : undefined;
		if (hit) {
			cachedHits++;
			entries.push(hit);
			continue;
		}
		jobs.push({ id: jobs.length, file: primary });
	}

	const pool = new ParsePool(concurrency);
	const parsedInfos = new Map<string, ModelInfo>();
	const parseErrors = new Map<string, string>();
	await Promise.all(
		jobs.map((job) =>
			pool
				.run(async (worker: Worker): Promise<ParseResponse> => {
					const response = await new Promise<ParseResponse>(
						(resolve, reject) => {
							const onMessage = (event: MessageEvent<ParseResponse>): void => {
								if (event.data.id !== job.id) return;
								worker.removeEventListener("message", onMessage);
								resolve(event.data);
							};
							const onError = (event: ErrorEvent): void => {
								worker.removeEventListener("error", onError);
								reject(event.error ?? new Error(event.message));
							};
							worker.addEventListener("message", onMessage);
							worker.addEventListener("error", onError);
							worker.postMessage({ id: job.id, path: job.file.path });
						},
					).catch(
						(err: unknown): ParseResponse => ({
							id: job.id,
							ok: false,
							error: err instanceof Error ? err.message : String(err),
						}),
					);
					return response;
				})
				.then((response) => {
					if (response.ok && response.info) {
						parsedInfos.set(job.file.path, response.info);
					} else {
						parseErrors.set(job.file.path, response.error ?? "parse failed");
					}
				}),
		),
	);
	pool.terminate();

	// Assemble rows for re-parsed groups only; cache hits were added above.
	const jobbedPaths = new Set(jobs.map((j) => j.file.path));
	for (const group of groups) {
		const primary = group.files[0];
		if (!primary || !jobbedPaths.has(primary.path)) continue;

		const totalBytes = group.files.reduce((a, f) => a + f.size, 0);
		const sig = signature(group.files);
		const incomplete =
			group.isSplit &&
			!isGroupComplete(
				group.files.map((f) => ({
					name: baseFileName(f.path),
					path: f.path,
				})),
			);

		const info = parsedInfos.get(primary.path);
		const error = parseErrors.get(primary.path);
		const entry: ModelEntry = {
			name: group.baseName,
			path: primary.path,
			paths: group.files.map((f) => f.path),
			totalBytes,
			architecture: info?.architecture,
			quantName: info ? info.quantName : "UNKNOWN",
			contextLength: info?.contextLength,
			blockCount: info?.blockCount,
			embeddingLength: info?.embeddingLength,
			headCount: info?.headCount,
			headCountKv: info?.headCountKv,
			keyLength: info?.keyLength,
			totalParams: info?.totalParams,
			effectiveBpw:
				info && info.totalParams > 0
					? (totalBytes * 8) / info.totalParams
					: undefined,
			...(incomplete ? { incomplete: true } : {}),
			...(error ? { error } : {}),
		};

		if (cache) cachePut(cache, primary.path, sig, entry);
		entries.push(entry);
	}

	entries.sort((a, b) => a.name.localeCompare(b.name));

	if (cache && options.stateDir) {
		dropStale(cache, livePaths);
		saveCache(options.stateDir, cache);
	}

	return {
		entries,
		stats: {
			filesWalked: walked.length,
			parsed: jobs.length,
			cachedHits,
		},
		errors: walkErrors,
	};
}
