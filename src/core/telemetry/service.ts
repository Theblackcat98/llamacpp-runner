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
	/**
	 * #12: fired exactly once per stop() with the peak mem_used_bytes seen
	 * during the run (null when no metrics were observed) — the calibration
	 * hook for estimator drift tracking.
	 */
	onRunEnd?: (peakMemUsedBytes: number | null) => void;
}

export function createTelemetryService(
	opts: TelemetryServiceOptions,
): TelemetryService {
	let monitor: TelemetryMonitor | null = null;
	let detach: (() => void) | null = null;
	const listeners = new Set<(snapshot: TelemetrySnapshot) => void>();
	let current: TelemetrySnapshot = {
		phase: "IDLE",
		health: null,
		metrics: null,
		slots: [],
	};
	let started = false;
	let peakMemUsedBytes: number | null = null;

	const publish = (patch: Partial<TelemetrySnapshot>) => {
		current = { ...current, ...patch };
		if (patch.metrics) {
			const seen = patch.metrics.memUsedBytes;
			if (typeof seen === "number" && seen > 0) {
				peakMemUsedBytes =
					peakMemUsedBytes === null ? seen : Math.max(peakMemUsedBytes, seen);
			}
		}
		for (const listener of [...listeners]) {
			try {
				listener(current);
			} catch {
				// A consumer must not stop telemetry collection.
			}
		}
	};

	const attach = (): void => {
		monitor = createTelemetryMonitor({
			supervisor: opts.supervisor,
			health: opts.health,
		});
		const offPhase = monitor.onChange((phase) => publish({ phase }));
		const offHealth = opts.health.onStatus((health) => publish({ health }));
		const offMetrics = opts.metrics.onSnapshot((metrics) =>
			publish({ metrics }),
		);
		const offSlots = opts.slots.onSlots((slots) => publish({ slots }));
		detach = () => {
			offPhase();
			offHealth();
			offMetrics();
			offSlots();
			monitor?.stop();
			monitor = null;
		};
	};

	return {
		get snapshot() {
			return current;
		},
		start() {
			if (started) return;
			started = true;
			attach();
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
			detach?.();
			detach = null;
			current = { phase: "IDLE", health: null, metrics: null, slots: [] };
			opts.onRunEnd?.(peakMemUsedBytes);
			peakMemUsedBytes = null;
		},
		onSnapshot(cb) {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
	};
}
