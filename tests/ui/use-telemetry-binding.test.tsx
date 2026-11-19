/**
 * Issue #70: sparkline history must survive STARTING→LOADING→READY.
 *
 * The pre-#70 SessionApp effect depended on procState, so React ran its
 * cleanup on every phase transition — disposing the whole telemetry
 * service and recreating the pollers, which wiped the MetricsPoller's
 * history rings (and peak tracking) twice per launch.
 *
 * This test drives the REAL useTelemetryBinding with a fake supervisor
 * and a fetch mock whose /metrics payload increments on every call:
 * if the binding were recreated at a transition, the poller instance
 * would change AND its first history sample would be a later value.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { act, useState } from "react";
import { createBus } from "../../src/core/bus";
import type {
	IntentMap,
	ProcState,
	StateMap,
} from "../../src/core/bus-contract";
import type { Supervisor } from "../../src/core/process/supervisor";
import type { createSession } from "../../src/core/session";
import {
	type TelemetryBinding,
	useTelemetryBinding,
} from "../../src/ui/hooks/use-telemetry-binding";
import { renderWithAct, teardownWithAct } from "./golden/harness";

type Session = ReturnType<typeof createSession>;

async function waitFor(
	cond: () => boolean,
	timeoutMs: number,
	label: string,
): Promise<void> {
	const start = Date.now();
	while (!cond()) {
		if (Date.now() - start > timeoutMs)
			throw new Error(`timed out waiting for ${label}`);
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

describe("useTelemetryBinding (Issue #70)", () => {
	const realFetch = globalThis.fetch;
	let metricsCalls = 0;

	afterEach(() => {
		globalThis.fetch = realFetch;
		metricsCalls = 0;
	});

	it("binds once per supervisor: history survives STARTING→LOADING→READY", async () => {
		globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
			const url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.href
						: input.url;
			if (url.endsWith("/metrics")) {
				metricsCalls++;
				const v = 100 + metricsCalls;
				return new Response(
					`# TYPE llamacpp:prompt_tokens_seconds gauge\nllamacpp:prompt_tokens_seconds ${v}\n# TYPE llamacpp:predicted_tokens_seconds gauge\nllamacpp:predicted_tokens_seconds ${v / 10}\n`,
					{ headers: { "content-type": "text/plain" } },
				);
			}
			if (url.endsWith("/health")) {
				return Response.json({ status: "ok", slots_idle: 0 });
			}
			if (url.endsWith("/slots")) {
				return Response.json([]);
			}
			return new Response(null, { status: 404 });
		}) as typeof fetch;

		const bus = createBus<IntentMap, StateMap>();
		const fakeSupervisor = {
			host: "127.0.0.1",
			port: 18931,
			onState: () => () => {},
		} as unknown as Supervisor;
		const fakeSession = { supervisor: fakeSupervisor } as unknown as Session;

		const probe: {
			binding?: TelemetryBinding;
			setProcState?: (s: ProcState) => void;
		} = {};
		function Probe() {
			const [procState, setProcState] = useState<ProcState>("STARTING");
			probe.setProcState = setProcState;
			probe.binding = useTelemetryBinding({
				bus,
				session: fakeSession,
				procState,
				telemetryEnabled: true,
			});
			return <text>probe</text>;
		}

		const setup = await renderWithAct(<Probe />, { width: 40, height: 6 });
		try {
			// First metrics tick lands in the history ring.
			await waitFor(
				() => (probe.binding?.promptHistory().length ?? 0) >= 1,
				5000,
				"first metrics sample",
			);
			const firstPoller = probe.binding?.metricsPoller();
			const firstSample = probe.binding?.promptHistory()[0];
			expect(firstPoller).not.toBeNull();
			expect(firstSample).toBe(101);

			// STARTING→LOADING: no rebind — same poller, same history.
			await act(async () => {
				probe.setProcState?.("LOADING");
				await setup.flush();
			});
			await new Promise((resolve) => setTimeout(resolve, 150));
			expect(probe.binding?.metricsPoller()).toBe(firstPoller);
			expect(probe.binding?.promptHistory()[0]).toBe(firstSample);

			// LOADING→READY: still the same binding; history intact.
			await act(async () => {
				probe.setProcState?.("READY");
				await setup.flush();
			});
			await new Promise((resolve) => setTimeout(resolve, 150));
			expect(probe.binding?.metricsPoller()).toBe(firstPoller);
			expect(probe.binding?.promptHistory()[0]).toBe(firstSample);
			// Exactly one /metrics fetch happened: the single binding's
			// initial tick. A recreated poller would have ticked again.
			expect(metricsCalls).toBe(1);

			// IDLE disposes the binding.
			await act(async () => {
				probe.setProcState?.("IDLE");
				await setup.flush();
			});
			expect(probe.binding?.metricsPoller()).toBeNull();
			expect(probe.binding?.promptHistory()).toEqual([]);
		} finally {
			await teardownWithAct(setup);
		}
	}, 20000);
});
