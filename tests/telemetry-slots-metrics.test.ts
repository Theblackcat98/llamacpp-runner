import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
	MetricsPoller,
	metricsSnapshot,
	parseMetrics,
} from "../src/core/telemetry/metrics";
import {
	parseSlots,
	type SlotSample,
	SlotsPoller,
} from "../src/core/telemetry/slots";
import { HistoryRing, sparkline } from "../src/core/telemetry/sparkline";

const FIX = (name: string) => join(import.meta.dir, "fixtures/metrics", name);

describe("parseMetrics — Prometheus text keyed on llamacpp: prefix (P5-FR-03)", () => {
	it("sync parse of captured payload (legacy b6000 shape: t/s as counters → null t/s, gauges still parsed)", async () => {
		const text = await Bun.file(FIX("real-b6000.prometheus")).text();
		const snap = parseMetrics(text);
		// The b6000 capture labels the t/s series as counters; instantaneous t/s
		// must not be manufactured from cumulative counters (issue #14).
		expect(snap.promptTps).toBeNull();
		expect(snap.decodeTps).toBeNull();
		expect(snap.kvUsageRatio).toBeCloseTo(0.42);
		expect(snap.memUsedBytes).toBe(6871947673);
	});

	it("tolerates unknown non-llamacpp series", async () => {
		const snap = parseMetrics(
			await Bun.file(FIX("real-b6000.prometheus")).text(),
		);
		expect(snap.kvUsageRatio).not.toBeNull(); // known series still parsed
	});

	it("labels are stripped: kv_cache_usage_ratio{layer=...} parses", async () => {
		const snap = parseMetrics(
			await Bun.file(FIX("real-b6000.prometheus")).text(),
		);
		expect(snap.kvUsageRatio).toBeCloseTo(0.42);
	});

	it("truncated payload yields partial snapshot, never throws", async () => {
		const snap = parseMetrics(
			await Bun.file(FIX("truncated.prometheus")).text(),
		);
		expect(snap.promptTps).toBeNull();
		expect(snap.decodeTps).toBeNull();
	});

	it("garbage payload yields all-null snapshot, never throws", async () => {
		const snap = parseMetrics(await Bun.file(FIX("garbage.prometheus")).text());
		expect(snap).toEqual({
			promptTps: null,
			decodeTps: null,
			kvUsageRatio: null,
			memUsedBytes: null,
			at: expect.any(Number),
		});
	});

	it("metricsSnapshot() fetches /metrics and maps to a snapshot", async () => {
		const server = Bun.serve({
			port: 0,
			fetch: () => new Response("llamacpp:predicted_tokens_seconds_total 42\n"),
		});
		const snap = await metricsSnapshot(
			`http://127.0.0.1:${server.port}/metrics`,
		);
		server.stop(true);
		expect(snap.decodeTps).toBe(42);
	});
});

describe("MetricsPoller", () => {
	it("emits snapshots on interval and stops cleanly", async () => {
		const server = Bun.serve({
			port: 0,
			fetch: () => new Response("llamacpp:kv_cache_usage_ratio 0.5\n"),
		});
		let polls = 0;
		const poller = new MetricsPoller({
			url: `http://127.0.0.1:${server.port}/metrics`,
			intervalMs: 30,
			timeoutMs: 500,
		});
		poller.onSnapshot(() => polls++);
		poller.start();
		await new Promise((r) => setTimeout(r, 120));
		poller.stop();
		server.stop(true);
		expect(polls).toBeGreaterThanOrEqual(2);
	});

	it("unreachable endpoint emits null-field snapshot with backoff", async () => {
		let calls = 0;
		const poller = new MetricsPoller({
			url: "http://127.0.0.1:1/metrics",
			intervalMs: 20,
			backoffMaxMs: 60,
			timeoutMs: 100,
			fetchImpl: async () => {
				calls++;
				throw new Error("refused");
			},
		});
		const snaps: Awaited<ReturnType<typeof metricsSnapshot>>[] = [];
		poller.onSnapshot((s) => snaps.push(s));
		poller.start();
		await new Promise((r) => setTimeout(r, 130));
		poller.stop();
		expect(snaps.length).toBeGreaterThanOrEqual(2);
		expect(snaps[0]?.decodeTps).toBeNull();
		expect(calls).toBeLessThan(130 / 20);
	});
});

describe("parseSlots — /slots JSON (P5-FR-02)", () => {
	it("maps id/state/prompt_tokens/generating", () => {
		const slots = parseSlots(
			'[{"id":0,"state":"ACTIVE","prompt_tokens":128,"generating":true},{"id":1,"state":"IDLE","prompt_tokens":0,"generating":false}]',
		);
		expect(slots).toEqual([
			{
				id: 0,
				state: "ACTIVE",
				promptTokens: 128,
				generating: true,
				idTask: null,
				decodedTokens: null,
			},
			{
				id: 1,
				state: "IDLE",
				promptTokens: 0,
				generating: false,
				idTask: null,
				decodedTokens: null,
			},
		] satisfies SlotSample[]);
	});

	it("defensive: lowercase state normalized, missing fields defaulted", () => {
		const slots = parseSlots('[{"id":"3","state":"generating"}]');
		expect(slots).toEqual([
			{
				id: 3,
				state: "GENERATING",
				promptTokens: null,
				generating: false,
				idTask: null,
				decodedTokens: null,
			},
		]);
	});

	it("malformed body -> empty array, never throws", () => {
		expect(parseSlots("<html>502</html>")).toEqual([]);
		expect(parseSlots('{"nope":true}')).toEqual([]);
		expect(parseSlots("[{broken")).toEqual([]);
	});
});

describe("SlotsPoller vs mock HTTP", () => {
	it("emits slot arrays on interval", async () => {
		const server = Bun.serve({
			port: 0,
			fetch: () =>
				Response.json([
					{ id: 0, state: "active", prompt_tokens: 10, generating: true },
				]),
		});
		const poller = new SlotsPoller({
			url: `http://127.0.0.1:${server.port}/slots`,
			intervalMs: 30,
			timeoutMs: 500,
		});
		const seen: SlotSample[][] = [];
		poller.onSlots((s) => seen.push(s));
		poller.start();
		await new Promise((r) => setTimeout(r, 100));
		poller.stop();
		server.stop(true);
		expect(seen.length).toBeGreaterThanOrEqual(2);
		expect(seen[0]?.[0]?.state).toBe("ACTIVE");
	});
});

describe("parseSlots — current upstream contract (issue #14)", () => {
	it("maps is_processing to generating and reads current token fields", () => {
		const slots = parseSlots(
			JSON.stringify([
				{
					id: 0,
					id_task: 135,
					n_ctx: 65536,
					speculative: false,
					is_processing: true,
					n_prompt_tokens: 128,
					n_prompt_tokens_processed: 128,
					n_prompt_tokens_cache: 0,
					next_token: { has_next_token: true, n_remain: -1, n_decoded: 42 },
				},
				{
					id: 1,
					id_task: 0,
					is_processing: false,
					n_prompt_tokens: 0,
					next_token: { has_next_token: true, n_decoded: 0 },
				},
			]),
		);
		expect(slots).toEqual([
			{
				id: 0,
				state: "PROCESSING",
				promptTokens: 128,
				generating: true,
				idTask: 135,
				decodedTokens: 42,
			},
			{
				id: 1,
				state: "IDLE",
				promptTokens: 0,
				generating: false,
				idTask: 0,
				decodedTokens: 0,
			},
		] satisfies SlotSample[]);
	});

	it("is_processing=false with prior task is idle, not generating", () => {
		const slots = parseSlots(
			'[{"id":0,"id_task":135,"is_processing":false,"n_prompt_tokens":64,"next_token":{"n_decoded":7}}]',
		);
		expect(slots[0]?.generating).toBe(false);
		expect(slots[0]?.state).toBe("IDLE");
	});

	it("legacy shape still parses (older servers)", () => {
		const slots = parseSlots(
			'[{"id":0,"state":"ACTIVE","prompt_tokens":128,"generating":true}]',
		);
		expect(slots[0]).toMatchObject({
			id: 0,
			state: "ACTIVE",
			promptTokens: 128,
			generating: true,
		});
	});

	it("current shape with no task yet: is_processing=false, null tokens", () => {
		const slots = parseSlots('[{"id":2,"id_task":-1,"is_processing":false}]');
		expect(slots[0]).toMatchObject({
			id: 2,
			state: "IDLE",
			promptTokens: null,
			generating: false,
			idTask: -1,
			decodedTokens: null,
		});
	});

	it("real current fixture parses with processing slot and counters", async () => {
		const body = await Bun.file(FIX("slots-current.json")).text();
		const slots = parseSlots(body);
		expect(slots.length).toBe(2);
		const busy = slots.find((s) => s.id === 0);
		expect(busy?.generating).toBe(true);
		expect(busy?.state).toBe("PROCESSING");
		expect(busy?.promptTokens).toBe(128);
		expect(busy?.decodedTokens).toBe(136);
	});
});

describe("parseMetrics — current upstream metric names (issue #14)", () => {
	it("parses current gauge names llamacpp:prompt_tokens_seconds / predicted_tokens_seconds", async () => {
		const snap = parseMetrics(
			await Bun.file(FIX("metrics-current.prometheus")).text(),
		);
		expect(snap.promptTps).toBeCloseTo(812.5);
		expect(snap.decodeTps).toBeCloseTo(23.4);
		// kv_cache_usage_ratio is not part of the current upstream /metrics
		// contract — unavailable, not a manufactured zero.
		expect(snap.kvUsageRatio).toBeNull();
		// memory_used_bytes was removed upstream — must be unavailable, not 0
		expect(snap.memUsedBytes).toBeNull();
	});

	it("distinguishes counters from gauges via # TYPE comments", () => {
		const snap = parseMetrics(
			[
				"# TYPE llamacpp:prompt_tokens_seconds gauge",
				"llamacpp:prompt_tokens_seconds 100",
				"# TYPE llamacpp:prompt_tokens_total counter",
				"llamacpp:prompt_tokens_total 999",
				"# TYPE llamacpp:predicted_tokens_seconds gauge",
				"llamacpp:predicted_tokens_seconds 55",
			].join("\n"),
		);
		// gauge t/s series wins over same-family counters
		expect(snap.promptTps).toBe(100);
		expect(snap.decodeTps).toBe(55);

		// counters (totals) are never mapped to instantaneous t/s
		const countersOnly = parseMetrics(
			[
				"# TYPE llamacpp:prompt_tokens_seconds_total counter",
				"llamacpp:prompt_tokens_seconds_total 812.5",
				"# TYPE llamacpp:predicted_tokens_seconds_total counter",
				"llamacpp:predicted_tokens_seconds_total 23.4",
			].join("\n"),
		);
		expect(countersOnly.promptTps).toBeNull();
		expect(countersOnly.decodeTps).toBeNull();
	});
});

describe("sparkline + history ring (P5-FR-05, P5-NFR-04)", () => {
	it("block-fill glyphs scale across min..max", () => {
		expect(sparkline([0, 0.25, 0.5, 0.75, 1])).toBe("▁▂▃▅▇");
		expect(sparkline([1, 1, 1])).toBe("▃▃▃"); // flat -> mid band
		expect(sparkline([])).toBe("");
	});

	it("width-capped: keeps the most recent samples", () => {
		expect(sparkline([1, 2, 3], 2)).toHaveLength(2);
		expect(sparkline([1, 2, 9], 2)).toBe("▁▇");
	});

	it("HistoryRing is capped (no unbounded growth)", () => {
		const ring = new HistoryRing<number>(4);
		for (let i = 0; i < 100; i++) ring.push(i);
		expect(ring.size).toBe(4);
		expect(ring.snapshot()).toEqual([96, 97, 98, 99]);
	});
});
