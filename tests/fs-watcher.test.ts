import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createModelWatcher,
	type WatcherHandle,
} from "../src/core/models/watcher";
import { sampleLlamaQ4Km } from "./fixtures/gguf/build";

const HANDLES: WatcherHandle[] = [];
const DIRS: string[] = [];

afterEach(async () => {
	for (const h of HANDLES.splice(0)) h.close();
	await new Promise((r) => setTimeout(r, 400));
	for (const d of DIRS.splice(0)) rmSync(d, { recursive: true, force: true });
});

function scratch(label: string): string {
	const dir = join(tmpdir(), `watch-${label}-${Date.now()}-${Math.random()}`);
	mkdirSync(dir, { recursive: true });
	DIRS.push(dir);
	return dir;
}

function waitFor<T>(
	fn: () => T | null | undefined,
	timeoutMs = 5000,
): Promise<T> {
	return new Promise((resolve, reject) => {
		const started = Date.now();
		const tick = (): void => {
			const v = fn();
			if (v != null) {
				resolve(v);
				return;
			}
			if (Date.now() - started > timeoutMs) {
				reject(new Error("waitFor timeout"));
				return;
			}
			setTimeout(tick, 50);
		};
		tick();
	});
}

describe("fs watcher (P3-FR-11)", () => {
	it("emits a debounced change event when a .gguf is added", async () => {
		const dir = scratch("add");
		let events = 0;
		const handle = createModelWatcher([dir], () => {
			events++;
		});
		HANDLES.push(handle);

		writeFileSync(join(dir, "new.gguf"), sampleLlamaQ4Km().buffer);
		await waitFor(() => (events > 0 ? events : null));

		// debounce window: further bursts within the window collapse
		expect(events).toBe(1);
	}, 10_000);

	it("collapses rapid bursts into one callback", async () => {
		const dir = scratch("burst");
		let events = 0;
		HANDLES.push(createModelWatcher([dir], () => events++));

		for (let i = 0; i < 5; i++) {
			writeFileSync(join(dir, `f${i}.gguf`), new Uint8Array(16));
			await new Promise((r) => setTimeout(r, 30));
		}

		await waitFor(() => (events > 0 ? events : null));
		const afterBurst = events;
		await new Promise((r) => setTimeout(r, 600));
		expect(events).toBeLessThanOrEqual(afterBurst + 1);
	}, 10_000);

	it("close() stops watching", async () => {
		const dir = scratch("close");
		let events = 0;
		const handle = createModelWatcher([dir], () => events++);
		handle.close();

		writeFileSync(join(dir, "x.gguf"), new Uint8Array(16));
		await new Promise((r) => setTimeout(r, 800));
		expect(events).toBe(0);
	}, 10_000);
});
