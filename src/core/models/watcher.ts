import { type FSWatcher, watch } from "node:fs";

export interface WatcherHandle {
	close(): void;
}

const DEBOUNCE_MS = 300;

/**
 * Watches directory trees recursively for changes and invokes the callback
 * at most once per debounce window (P3-FR-11: >=300 ms).
 *
 * #17: the watch is RECURSIVE so changes inside nested model directories
 * invalidate too, and EVERY filesystem event schedules a rescan — a
 * rename/delete may present a filename that no longer ends in .gguf (or
 * none at all), so the event name must not be the invalidation filter.
 * The debounced full rescan is the filter.
 */
export function createModelWatcher(
	dirs: string[],
	onChange: (changedDir: string) => void,
	debounceMs = DEBOUNCE_MS,
): WatcherHandle {
	const timers = new Map<string, ReturnType<typeof setTimeout>>();
	const watchers: FSWatcher[] = [];

	const schedule = (dir: string): void => {
		const existing = timers.get(dir);
		if (existing) clearTimeout(existing);
		timers.set(
			dir,
			setTimeout(() => {
				timers.delete(dir);
				onChange(dir);
			}, debounceMs),
		);
	};

	for (const dir of dirs) {
		try {
			const watcher = watch(dir, { persistent: false, recursive: true }, () =>
				schedule(dir),
			);
			watchers.push(watcher);
		} catch {
			// dir vanished or unsupported -> full-rescan fallback stays available
		}
	}

	return {
		close(): void {
			for (const t of timers.values()) clearTimeout(t);
			timers.clear();
			for (const w of watchers) w.close();
		},
	};
}
