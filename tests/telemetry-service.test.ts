import { describe, expect, it } from "bun:test";
import { createTelemetryService } from "../src/core/telemetry/service";

type Listener<T> = (value: T) => void;

function fakePoller<T>(value: T) {
	const listeners = new Set<Listener<T>>();
	return {
		starts: 0,
		stops: 0,
		onStatus(cb: Listener<T>) {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		onSnapshot(cb: Listener<T>) {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		onSlots(cb: Listener<T>) {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		start() {
			this.starts++;
		},
		stop() {
			this.stops++;
		},
		emit(next: T) {
			for (const listener of [...listeners]) listener(next);
		},
		value,
	};
}

describe("telemetry service", () => {
	it("starts and stops all pollers and publishes snapshots", () => {
		const supervisor = {
			onState() {
				return () => {};
			},
		} as never;
		const health = fakePoller({ status: "ready", latencyMs: 1, at: 1 });
		const metrics = fakePoller({
			promptTps: 1,
			decodeTps: 2,
			kvUsageRatio: 0.3,
			memUsedBytes: 4,
			at: 1,
		});
		const slots = fakePoller([
			{
				id: 0,
				state: "IDLE",
				promptTokens: 0,
				generating: false,
				idTask: null,
				decodedTokens: null,
			},
		]);
		const service = createTelemetryService({
			supervisor,
			health: health as never,
			metrics: metrics as never,
			slots: slots as never,
		});
		const seen: unknown[] = [];
		service.onSnapshot((snapshot) => seen.push(snapshot));
		service.start();
		expect(health.starts).toBe(1);
		expect(metrics.starts).toBe(1);
		expect(slots.starts).toBe(1);
		health.emit(health.value);
		metrics.emit(metrics.value);
		slots.emit(slots.value);
		expect(service.snapshot.health?.status).toBe("ready");
		expect(service.snapshot.metrics?.decodeTps).toBe(2);
		expect(service.snapshot.slots).toHaveLength(1);
		expect(seen.length).toBe(3);
		service.stop();
		expect(health.stops).toBe(1);
		expect(metrics.stops).toBe(1);
		expect(slots.stops).toBe(1);
		health.emit(health.value);
		expect(seen.length).toBe(3);
		service.start();
		expect(health.starts).toBe(2);
		health.emit(health.value);
		expect(seen.length).toBe(4);
	});

	it("isolates subscriber failures", () => {
		const supervisor = {
			onState() {
				return () => {};
			},
		} as never;
		const health = fakePoller({ status: "ready", latencyMs: 1, at: 1 });
		const metrics = fakePoller(null);
		const slots = fakePoller([]);
		const service = createTelemetryService({
			supervisor,
			health: health as never,
			metrics: metrics as never,
			slots: slots as never,
		});
		let called = false;
		service.onSnapshot(() => {
			throw new Error("consumer failure");
		});
		service.onSnapshot(() => {
			called = true;
		});
		service.start();
		health.emit(health.value);
		expect(called).toBe(true);
	});

	it("#12: tracks peak mem_used across a run and fires onRunEnd at teardown", () => {
		const supervisor = {
			onState() {
				return () => {};
			},
		} as never;
		const health = fakePoller({ status: "ready", latencyMs: 1, at: 1 });
		const metrics = fakePoller({
			promptTps: 1,
			decodeTps: 2,
			kvUsageRatio: 0.3,
			memUsedBytes: null as number | null,
			at: 1,
		});
		const slots = fakePoller([]);
		const ended: (number | null)[] = [];
		const service = createTelemetryService({
			supervisor,
			health: health as never,
			metrics: metrics as never,
			slots: slots as never,
			onRunEnd: (peak) => ended.push(peak),
		});
		service.start();
		metrics.emit({ ...metrics.value, memUsedBytes: 100 });
		metrics.emit({ ...metrics.value, memUsedBytes: 300 });
		metrics.emit({ ...metrics.value, memUsedBytes: 200 });
		service.stop();
		expect(ended).toEqual([300]);

		// Second run resets the peak; no metrics seen -> null.
		service.start();
		service.stop();
		expect(ended).toEqual([300, null]);
	});

	it("#12: onRunEnd is optional and defaults to no-op", () => {
		const supervisor = {
			onState() {
				return () => {};
			},
		} as never;
		const service = createTelemetryService({
			supervisor,
			health: fakePoller(null) as never,
			metrics: fakePoller(null) as never,
			slots: fakePoller([]) as never,
		});
		service.start();
		service.stop();
	});
});
