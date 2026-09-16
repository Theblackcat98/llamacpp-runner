/**
 * /slots poller (§3.5, P5-FR-02): 5 s default interval. Requires --slots at
 * launch (P5-FR-06); consumers decide dormant-state rendering.
 */
export interface SlotSample {
	id: number;
	state: string;
	promptTokens: number | null;
	generating: boolean;
	/** Upstream task id for the slot's current/last task; -1 when idle. */
	idTask: number | null;
	/** Upstream next_token.n_decoded — tokens generated in the current task. */
	decodedTokens: number | null;
}

function asNumber(v: unknown): number | null {
	return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asBool(v: unknown): boolean | null {
	return typeof v === "boolean" ? v : null;
}

export function parseSlots(body: string): SlotSample[] {
	let data: unknown;
	try {
		data = JSON.parse(body);
	} catch {
		return [];
	}
	if (!Array.isArray(data)) return [];
	const out: SlotSample[] = [];
	for (const raw of data) {
		if (raw === null || typeof raw !== "object") continue;
		const o = raw as Record<string, unknown>;
		const id = Number(o.id);
		if (!Number.isInteger(id)) continue;
		const idTask =
			typeof o.id_task === "number" && Number.isFinite(o.id_task)
				? o.id_task
				: null;
		const nextToken =
			o.next_token !== null &&
			typeof o.next_token === "object" &&
			!Array.isArray(o.next_token)
				? (o.next_token as Record<string, unknown>)
				: null;
		const decodedTokens =
			nextToken &&
			typeof nextToken.n_decoded === "number" &&
			Number.isFinite(nextToken.n_decoded)
				? nextToken.n_decoded
				: null;
		// Current upstream contract (llama.cpp #9291): slot[i].state was removed
		// in favor of is_processing. Legacy `state`/`generating` fields are still
		// honored for older servers.
		const isProcessing = asBool(o.is_processing);
		const legacyState =
			typeof o.state === "string" ? o.state.toUpperCase() : "";
		const legacyGenerating = asBool(o.generating);
		const generating = isProcessing ?? legacyGenerating ?? false;
		const state =
			isProcessing !== null
				? isProcessing
					? "PROCESSING"
					: "IDLE"
				: legacyState.length > 0
					? legacyState
					: "UNKNOWN";
		const legacyPromptTokens = asNumber(o.prompt_tokens);
		const promptTokens = asNumber(o.n_prompt_tokens) ?? legacyPromptTokens;
		out.push({
			id,
			state,
			promptTokens,
			generating,
			idTask,
			decodedTokens,
		});
	}
	return out;
}

export class SlotsPoller {
	private timer: ReturnType<typeof setTimeout> | null = null;
	private running = false;
	private consecutiveFailures = 0;
	private listeners = new Set<(slots: SlotSample[]) => void>();
	private readonly intervalMs: number;
	private readonly timeoutMs: number;
	private readonly backoffMaxMs: number;

	constructor(
		private readonly opts: {
			url: string;
			intervalMs?: number;
			timeoutMs?: number;
			backoffMaxMs?: number;
			fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
		},
	) {
		this.intervalMs = opts.intervalMs ?? 5000;
		this.timeoutMs = opts.timeoutMs ?? 2000;
		this.backoffMaxMs = opts.backoffMaxMs ?? 15000;
		this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
	}

	private fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;

	onSlots(cb: (s: SlotSample[]) => void): () => void {
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
			const res = await this.fetchImpl(this.opts.url, {
				signal: AbortSignal.timeout(this.timeoutMs),
			});
			const slots = res.ok ? parseSlots(await res.text()) : [];
			ok = res.ok;
			for (const cb of [...this.listeners]) cb(slots);
		} catch {
			for (const cb of [...this.listeners]) cb([]);
		}
		this.consecutiveFailures = ok ? 0 : this.consecutiveFailures + 1;
		if (!this.running) return;
		this.timer = setTimeout(() => void this.tick(), this.currentInterval());
	}
}
