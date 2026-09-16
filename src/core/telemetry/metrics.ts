/**
 * Prometheus /metrics scraping (§3.5, P5-FR-03). Parser is keyed on the
 * "llamacpp:" metric-name prefix with strict-unknown tolerance: unknown or
 * malformed series are skipped, known series with unparseable values yield
 * null — parsing NEVER throws. tokens/sec comes from /metrics only, never
 * from log lines.
 */
import { RingBuffer } from "../process/ring-buffer";

export interface MetricsSnapshot {
	promptTps: number | null;
	decodeTps: number | null;
	kvUsageRatio: number | null;
	memUsedBytes: number | null;
	at: number;
}

const SERIES_KEYS = {
	promptTps: [
		// Current upstream gauge (llama.cpp #9291): average prompt throughput.
		"llamacpp:prompt_tokens_seconds",
		// Legacy names kept for older servers.
		"llamacpp:prompt_tokens_seconds_total",
	],
	decodeTps: [
		"llamacpp:predicted_tokens_seconds",
		"llamacpp:predicted_tokens_seconds_total",
	],
	kvUsageRatio: ["llamacpp:kv_cache_usage_ratio"],
	// Removed upstream (llama.cpp #9291): treated as unavailable when absent.
	memUsedBytes: ["llamacpp:memory_used_bytes"],
} as const;

/**
 * Series explicitly reported as Prometheus counters via `# TYPE` comments.
 * Counters are cumulative; instantaneous t/s snapshots must come from gauges,
 * so counter samples are never mapped to the t/s fields.
 */
function parseCounterNames(text: string): Set<string> {
	const counters = new Set<string>();
	for (const line of text.split("\n")) {
		const m = /^#\s*TYPE\s+(\S+)\s+counter\b/.exec(line.trim());
		if (m?.[1]) counters.add(m[1]);
	}
	return counters;
}

/** Parse a single sample line `name{labels} value [timestamp]`. */
function parseSample(line: string): { name: string; value: number } | null {
	const spaceIdx = line.search(/\s/);
	if (spaceIdx < 0) return null;
	const rawName = line.slice(0, spaceIdx).trim();
	const braceStart = rawName.indexOf("{");
	const bareName = braceStart >= 0 ? rawName.slice(0, braceStart) : rawName;
	const raw = line
		.slice(spaceIdx + 1)
		.trim()
		.split(/\s+/)[0];
	if (!raw || !/^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/.test(raw))
		return null;
	const value = Number(raw);
	return Number.isFinite(value) ? { name: bareName, value } : null;
}

export function parseMetrics(text: string): MetricsSnapshot {
	const snap: MetricsSnapshot = {
		promptTps: null,
		decodeTps: null,
		kvUsageRatio: null,
		memUsedBytes: null,
		at: Date.now(),
	};
	const counters = parseCounterNames(text);
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
		const sample = parseSample(trimmed);
		if (!sample) continue;
		if (counters.has(sample.name)) {
			// Counters never map to instantaneous fields (see parseCounterNames).
			continue;
		}
		for (const [key, series] of Object.entries(SERIES_KEYS)) {
			if (
				(series as readonly string[]).includes(sample.name) &&
				snap[key as keyof MetricsSnapshot] === null
			) {
				snap[key as keyof Omit<MetricsSnapshot, "at">] = sample.value;
			}
		}
	}
	return snap;
}

export async function metricsSnapshot(
	url: string,
	timeoutMs = 2000,
	fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = (u, i) =>
		fetch(u, i),
): Promise<MetricsSnapshot> {
	try {
		const res = await fetchImpl(url, {
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (!res.ok) return parseMetrics("");
		return parseMetrics(await res.text());
	} catch {
		return parseMetrics("");
	}
}

export interface MetricsPollerOptions {
	url: string;
	intervalMs?: number;
	timeoutMs?: number;
	backoffMaxMs?: number;
	historySize?: number;
	fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
}

/**
 * /metrics poller (5 s default per §1.2). Emits snapshots plus capped history
 * rings per tracked metric (P5-NFR-04).
 */
export class MetricsPoller {
	private timer: ReturnType<typeof setTimeout> | null = null;
	private running = false;
	private consecutiveFailures = 0;
	private listeners = new Set<(s: MetricsSnapshot) => void>();
	private readonly intervalMs: number;
	private readonly timeoutMs: number;
	private readonly backoffMaxMs: number;
	private readonly doFetch: (
		url: string,
		init?: RequestInit,
	) => Promise<Response>;
	readonly promptHistory: RingBuffer<number>;
	readonly decodeHistory: RingBuffer<number>;
	readonly kvHistory: RingBuffer<number>;

	constructor(private readonly opts: MetricsPollerOptions) {
		this.intervalMs = opts.intervalMs ?? 5000;
		this.timeoutMs = opts.timeoutMs ?? 2000;
		this.backoffMaxMs = opts.backoffMaxMs ?? 15000;
		const size = opts.historySize ?? 120;
		this.promptHistory = new RingBuffer(size);
		this.decodeHistory = new RingBuffer(size);
		this.kvHistory = new RingBuffer(size);
		this.doFetch = opts.fetchImpl ?? ((url, init) => fetch(url, init));
	}

	onSnapshot(cb: (s: MetricsSnapshot) => void): () => void {
		this.listeners.add(cb);
		return () => this.listeners.delete(cb);
	}

	start(): void {
		if (this.running) return;
		this.running = true;
		void this.tick();
	}

	stop(): void {
		this.running = false;
		if (this.timer !== null) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}

	private currentInterval(): number {
		if (this.consecutiveFailures === 0) return this.intervalMs;
		const factor = 2 ** Math.min(this.consecutiveFailures, 4);
		return Math.min(this.intervalMs * factor, this.backoffMaxMs);
	}

	private async tick(): Promise<void> {
		if (!this.running) return;
		let ok = false;
		try {
			const res = await this.doFetch(this.opts.url, {
				signal: AbortSignal.timeout(this.timeoutMs),
			});
			const text = res.ok ? await res.text() : "";
			const snap = parseMetrics(text);
			ok =
				res.ok &&
				(snap.promptTps !== null ||
					snap.decodeTps !== null ||
					snap.kvUsageRatio !== null ||
					snap.memUsedBytes !== null);
			if (ok) {
				if (snap.promptTps !== null) this.promptHistory.push(snap.promptTps);
				if (snap.decodeTps !== null) this.decodeHistory.push(snap.decodeTps);
				if (snap.kvUsageRatio !== null) this.kvHistory.push(snap.kvUsageRatio);
			}
			for (const cb of [...this.listeners]) cb(snap);
		} catch {
			for (const cb of [...this.listeners]) cb(parseMetrics(""));
		}
		this.consecutiveFailures = ok ? 0 : this.consecutiveFailures + 1;
		if (!this.running) return;
		this.timer = setTimeout(() => void this.tick(), this.currentInterval());
	}
}
