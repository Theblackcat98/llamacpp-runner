/**
 * /health poller (§3.5, P5-FR-01). 2 s default interval, 2 s HTTP timeout,
 * exponential backoff on failure (P5-NFR-01). Never blocks the render loop:
 * consumers subscribe via onStatus.
 */
export type HealthStatus = "ready" | "loading" | "unreachable";

export interface HealthSample {
	status: HealthStatus;
	/** HTTP round-trip latency in ms; 0 when unreachable before a response. */
	latencyMs: number;
	at: number;
}

export interface HealthPollerOptions {
	url: string;
	intervalMs?: number;
	timeoutMs?: number;
	backoffMaxMs?: number;
	fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
}

export class HealthPoller {
	private timer: ReturnType<typeof setTimeout> | null = null;
	private running = false;
	private consecutiveFailures = 0;
	private listeners = new Set<(s: HealthSample) => void>();
	private readonly intervalMs: number;
	private readonly timeoutMs: number;
	private readonly backoffMaxMs: number;
	private readonly doFetch: (
		url: string,
		init?: RequestInit,
	) => Promise<Response>;

	constructor(private readonly opts: HealthPollerOptions) {
		this.intervalMs = opts.intervalMs ?? 2000;
		this.timeoutMs = opts.timeoutMs ?? 2000;
		this.backoffMaxMs = opts.backoffMaxMs ?? 8000;
		this.doFetch = opts.fetchImpl ?? ((url, init) => fetch(url, init));
	}

	onStatus(cb: (s: HealthSample) => void): () => void {
		this.listeners.add(cb);
		return () => this.listeners.delete(cb);
	}

	start(): void {
		if (this.running) return;
		this.running = true;
		this.consecutiveFailures = 0;
		void this.tick();
	}

	stop(): void {
		this.running = false;
		if (this.timer !== null) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}

	get isRunning(): boolean {
		return this.running;
	}

	private currentInterval(): number {
		if (this.consecutiveFailures === 0) return this.intervalMs;
		const factor = 2 ** Math.min(this.consecutiveFailures, 4);
		return Math.min(this.intervalMs * factor, this.backoffMaxMs);
	}

	private async tick(): Promise<void> {
		if (!this.running) return;
		const sample = await this.probe();
		if (sample.status !== "unreachable") this.consecutiveFailures = 0;
		for (const cb of [...this.listeners]) cb(sample);
		if (!this.running) return;
		this.timer = setTimeout(() => void this.tick(), this.currentInterval());
	}

	private async probe(): Promise<HealthSample> {
		const started = Date.now();
		try {
			const res = await withTimeout(
				this.doFetch(this.opts.url, {
					signal: AbortSignal.timeout(this.timeoutMs),
				}),
				this.timeoutMs,
			);
			const status: HealthStatus =
				res.status === 200
					? "ready"
					: res.status === 503
						? "loading"
						: "unreachable";
			return { status, latencyMs: Date.now() - started, at: Date.now() };
		} catch {
			this.consecutiveFailures++;
			return {
				status: "unreachable",
				latencyMs: Date.now() - started,
				at: Date.now(),
			};
		}
	}
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error("health probe timeout")), ms);
	});
	try {
		return await Promise.race([p, timeout]);
	} finally {
		clearTimeout(timer);
	}
}
