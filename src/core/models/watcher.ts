import { type FSWatcher, watch } from "node:fs";

export interface WatcherHandle {
	close(): void;
}

const DEBOUNCE_MS = 300;

/**
 * Watches directories for .gguf create/unlink/rename events and invokes the
 * callback at most once per debounce window (P3-FR-11: >=300 ms).
 */
export function createModelWatcher(
	dirs: string[],
	onChange: (changedDir: string) => void,
	debounceMs = DEBOUNCE_MS,
): WatcherHandle {
	const timers = new Map<string, ReturnType<typeof setTimeout>>();
	const watchers: FSWatcher[] = [];

	for (const dir of dirs) {
		try {
			const watcher = watch(dir, { persistent: false }, (_event, filename) => {
				if (filename && !filename.toLowerCase().endsWith(".gguf")) return;
				const existing = timers.get(dir);
				if (existing) clearTimeout(existing);
				timers.set(
					dir,
					setTimeout(() => {
						timers.delete(dir);
						onChange(dir);
					}, debounceMs),
				);
			});
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
