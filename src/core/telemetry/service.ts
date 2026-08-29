import type { Supervisor } from "../process/supervisor";
import type { HealthPoller, HealthSample } from "./health";
import type { MetricsPoller, MetricsSnapshot } from "./metrics";
import type { SlotSample, SlotsPoller } from "./slots";
import {
	createTelemetryMonitor,
	type TelemetryMonitor,
	type TelemetryPhase,
} from "./state-machine";

export interface TelemetrySnapshot {
	phase: TelemetryPhase;
	health: HealthSample | null;
	metrics: MetricsSnapshot | null;
	slots: SlotSample[];
}

export interface TelemetryService {
	readonly snapshot: TelemetrySnapshot;
	start(): void;
	stop(): void;
	onSnapshot(cb: (snapshot: TelemetrySnapshot) => void): () => void;
}

export interface TelemetryServiceOptions {
	supervisor: Supervisor;
	health: HealthPoller;
	metrics: MetricsPoller;
	slots: SlotsPoller;
}

export function createTelemetryService(
	opts: TelemetryServiceOptions,
): TelemetryService {
	const monitor: TelemetryMonitor = createTelemetryMonitor({
		supervisor: opts.supervisor,
		health: opts.health,
	});
	const listeners = new Set<(snapshot: TelemetrySnapshot) => void>();
	let current: TelemetrySnapshot = {
		phase: "IDLE",
		health: null,
		metrics: null,
		slots: [],
	};
	let started = false;

	const publish = (patch: Partial<TelemetrySnapshot>) => {
		current = { ...current, ...patch };
		for (const listener of [...listeners]) {
			try {
				listener(current);
			} catch {
				// A consumer must not stop telemetry collection.
			}
		}
	};

	const offPhase = monitor.onChange((phase) => publish({ phase }));
	const offHealth = opts.health.onStatus((health) => publish({ health }));
	const offMetrics = opts.metrics.onSnapshot((metrics) => publish({ metrics }));
	const offSlots = opts.slots.onSlots((slots) => publish({ slots }));

	return {
		get snapshot() {
			return current;
		},
		start() {
			if (started) return;
			started = true;
			opts.health.start();
			opts.metrics.start();
			opts.slots.start();
		},
		stop() {
			if (!started) return;
			started = false;
			opts.health.stop();
			opts.metrics.stop();
			opts.slots.stop();
			monitor.stop();
			offPhase();
			offHealth();
			offMetrics();
			offSlots();
		},
		onSnapshot(cb) {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
	};
}
