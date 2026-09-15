import { describe, expect, it } from "bun:test";
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

import { join } from "node:path";

const FIX = (name: string) =>
	join(import.meta.dir, "fixtures/metrics", name);

describe("parseMetrics — Prometheus text keyed on llamacpp: prefix (P5-FR-03)", () => {
	it("sync parse of captured payload", async () => {
		const text = await Bun.file(FIX("real-b6000.prometheus")).text();
		const snap = parseMetrics(text);
		expect(snap.promptTps).toBeCloseTo(812.5);
		expect(snap.decodeTps).toBeCloseTo(23.4);
		expect(snap.kvUsageRatio).toBeCloseTo(0.42);
		expect(snap.memUsedBytes).toBe(6871947673);
	});

	it("tolerates unknown non-llamacpp series", async () => {
		const snap = parseMetrics(
			await Bun.file(FIX("real-b6000.prometheus")).text(),
		);
		expect(snap.promptTps).not.toBeNull(); // known series still parsed
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
			{ id: 0, state: "ACTIVE", promptTokens: 128, generating: true },
			{ id: 1, state: "IDLE", promptTokens: 0, generating: false },
		] satisfies SlotSample[]);
	});

	it("defensive: lowercase state normalized, missing fields defaulted", () => {
		const slots = parseSlots('[{"id":"3","state":"generating"}]');
		expect(slots).toEqual([
			{ id: 3, state: "GENERATING", promptTokens: null, generating: true },
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
