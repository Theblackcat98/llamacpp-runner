import { useEffect, useRef, useState } from "react";
import type { createBus } from "../../core/bus";
import type { IntentMap, ProcState, StateMap } from "../../core/bus-contract";
import { DEFAULT_HOST, DEFAULT_PORT } from "../../core/constants";
import type { Supervisor } from "../../core/process/supervisor";
import type { createSession } from "../../core/session";
import { HealthPoller } from "../../core/telemetry/health";
import { MetricsPoller } from "../../core/telemetry/metrics";
import {
	createTelemetryService,
	type TelemetrySnapshot,
} from "../../core/telemetry/service";
import { SlotsPoller } from "../../core/telemetry/slots";

type Bus = ReturnType<typeof createBus<IntentMap, StateMap>>;
type Session = ReturnType<typeof createSession>;

/**
 * Stop handle for the telemetry set bound by useTelemetryBinding
 * (Issue #16). Owned exclusively by the binding effect: assigned on
 * bind, cleared on dispose. Consumed only by the process-quit path,
 * which runs outside React and therefore cannot rely on effect cleanup
 * ordering.
 */
let telemetryStopHandle: (() => void) | null = null;

/** Process-quit path: stop whatever telemetry set is currently bound. */
export function stopBoundTelemetry(): void {
	telemetryStopHandle?.();
}

export interface TelemetryBinding {
	telemetry: TelemetrySnapshot;
	endpoint: string;
	promptHistory: () => number[];
	decodeHistory: () => number[];
	/** The MetricsPoller of the current binding (null while unbound). */
	metricsPoller: () => MetricsPoller | null;
}

/**
 * Issue #70 / #16: telemetry binding extracted from SessionApp, with
 * the phase-transition churn fixed.
 *
 * Telemetry follows the managed server lifecycle — never React render.
 * Exactly one poller set is bound while a server instance is active;
 * it is disposed on exit/kill/swap or when telemetry is toggled off.
 *
 * The old effect depended on procState directly, so React ran its
 * cleanup on EVERY phase transition — the cleanup disposed the whole
 * service (health/metrics/slots pollers + monitor) and nulled the
 * bound-supervisor ref, and the re-run then built a fresh service.
 * STARTING→LOADING→READY therefore recreated the pollers twice,
 * wiping sparkline history and peak tracking each time.
 *
 * The fix: the effect depends on the supervisor's IDENTITY plus a
 * boolean "should be bound" — phase transitions within one supervisor
 * lifetime change neither, so the effect does not re-run and the
 * single binding (and its history rings) survives STARTING→READY.
 * Disposal happens exactly when the boolean flips off (IDLE/FAILED/
 * toggle), the supervisor is swapped, or the component unmounts.
 */
export function useTelemetryBinding(opts: {
	bus: Bus;
	session: Session;
	procState: ProcState;
	telemetryEnabled: boolean;
}): TelemetryBinding {
	const { bus, session, procState, telemetryEnabled } = opts;
	const [telemetry, setTelemetry] = useState<TelemetrySnapshot>({
		phase: "IDLE",
		health: null,
		metrics: null,
		slots: [],
	});
	const [endpoint, setEndpoint] = useState("");
	const metricsRef = useRef<MetricsPoller | null>(null);

	// TELEMETRY_STATE snapshots are how the bound service reports up.
	// biome-ignore lint/correctness/useExhaustiveDependencies: subscription is bound on mount
	useEffect(() => {
		const offTelemetry = bus.onState("TELEMETRY_STATE", (event) => {
			setTelemetry(event);
		});
		return () => {
			offTelemetry();
		};
	}, []);

	// Read during render so a supervisor swap is visible to the effect
	// deps below (the session installs a fresh supervisor per LAUNCH;
	// PROC_STATE events drive the re-render that observes it).
	const supervisor: Supervisor | null = session.supervisor;
	const shouldBind =
		telemetryEnabled &&
		procState !== "IDLE" &&
		procState !== "FAILED" &&
		supervisor !== null;

	useEffect(() => {
		if (!shouldBind || supervisor === null) return;
		// Pollers bind to the launch plan's supervisor endpoint at spawn
		// time rather than tracking live configurator edits.
		const boundEndpoint = `http://${supervisor.host ?? DEFAULT_HOST}:${supervisor.port ?? DEFAULT_PORT}`;
		const metrics = new MetricsPoller({ url: `${boundEndpoint}/metrics` });
		const service = createTelemetryService({
			supervisor,
			health: new HealthPoller({ url: `${boundEndpoint}/health` }),
			metrics,
			slots: new SlotsPoller({ url: `${boundEndpoint}/slots` }),
		});
		service.onSnapshot((snapshot) =>
			bus.emitState("TELEMETRY_STATE", snapshot),
		);
		metricsRef.current = metrics;
		setEndpoint(boundEndpoint);
		service.start();
		const stopHandle = () => service.stop();
		telemetryStopHandle = stopHandle;
		return () => {
			service.stop();
			if (telemetryStopHandle === stopHandle) telemetryStopHandle = null;
			if (metricsRef.current === metrics) metricsRef.current = null;
		};
	}, [bus, supervisor, shouldBind]);

	return {
		telemetry,
		endpoint,
		promptHistory: () => metricsRef.current?.promptHistory.snapshot() ?? [],
		decodeHistory: () => metricsRef.current?.decodeHistory.snapshot() ?? [],
		metricsPoller: () => metricsRef.current,
	};
}
