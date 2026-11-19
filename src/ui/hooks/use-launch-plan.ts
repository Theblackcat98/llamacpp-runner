import { type RefObject, useEffect, useRef } from "react";
import type { createBus } from "../../core/bus";
import type { IntentMap, StateMap } from "../../core/bus-contract";
import {
	DEFAULT_HOST,
	DEFAULT_PORT,
	LLAMA_SERVER_BIN,
} from "../../core/constants";
import { copyToClipboard } from "../../core/export/clipboard";
import { buildCommand, commandLine } from "../../core/flags/builder";
import { type ProbeResult, resolveBinaryPath } from "../../core/flags/validate";
import type { LaunchPlan } from "../../core/session";
import {
	type ConfiguratorState,
	effectiveValues,
} from "../logic/configurator-state";

type Bus = ReturnType<typeof createBus<IntentMap, StateMap>>;

/**
 * Issue #70: the module-level plan source for the production (default)
 * session. Written ONLY by useLaunchPlan's registration effect — never
 * during render (the old SessionApp assigned it in the component body,
 * so every render mutated a module singleton).
 */
let planSource: (() => LaunchPlan | null) | null = null;

/** resolveLaunch for the default session created in main.tsx. */
export function resolveDefaultLaunchPlan(): LaunchPlan | null {
	return planSource?.() ?? null;
}

export interface LaunchPlanApi {
	buildPlan: () => LaunchPlan | null;
	launchPlan: LaunchPlan | null;
	launchPreview: string;
	/** True (and logged) when the configured model is an incomplete split. */
	launchSplitDiagnostic: () => boolean;
	yankCommand: () => void;
}

/**
 * Issue #70: launch-plan construction extracted from SessionApp. The
 * plan derives from the configurator + the binary capability probe
 * (Issue #15: flags the resolved binary does not support are dropped
 * from the actual argv — the same map drives the preview).
 *
 * Registration: the session resolves plans lazily at launch time, so
 * the hook registers ONE stable resolver whose target is refreshed in
 * an effect after every render. Registration itself is an effect —
 * it never happens in the render path.
 */
export function useLaunchPlan(opts: {
	bus: Bus;
	config: ConfiguratorState;
	configRef: RefObject<ConfiguratorState>;
	capability: ProbeResult | null;
	configuredBinaryPath: string | undefined;
	setPlanSource?: (fn: () => LaunchPlan | null) => void;
}): LaunchPlanApi {
	const {
		bus,
		config,
		configRef,
		capability,
		configuredBinaryPath,
		setPlanSource,
	} = opts;

	function buildPlan(): LaunchPlan | null {
		// Tier 3: read the LIVE config ref, not the render closure — Load &
		// Launch updates configRef synchronously in the same tick it emits
		// LAUNCH, and the resolver must see the preset just loaded.
		const cfg = configRef.current;
		// #18: an incomplete split group never resolves to a launch plan.
		// #60: neither does a stale (vanished) model file.
		if (!cfg.model || cfg.model.incomplete || cfg.model.stale) return null;
		const binary = resolveBinaryPath({ configured: configuredBinaryPath });
		const command =
			capability?.resolvedPath ??
			(binary.status === "ok"
				? binary.path
				: (configuredBinaryPath ?? LLAMA_SERVER_BIN));
		const built = buildCommand({
			modelPath: cfg.model.path,
			meta: { blockCount: cfg.model.blockCount },
			values: effectiveValues(cfg),
			// Issue #15: flags the resolved binary does not support are
			// dropped from the actual argv — the same map drives the preview.
			availability: capability?.availability,
		});
		return {
			// F10/#15: the RESOLVED binary path (configured binary_path or
			// PATH) is the single source of truth for preview and launch.
			command,
			args: built.args,
			port:
				typeof cfg.values.port === "number"
					? (cfg.values.port as number)
					: DEFAULT_PORT,
			presetId: "ad-hoc",
			host:
				typeof cfg.values.host === "string"
					? (cfg.values.host as string)
					: DEFAULT_HOST,
		};
	}

	const buildPlanRef = useRef(buildPlan);
	useEffect(() => {
		buildPlanRef.current = buildPlan;
	});
	const stableResolverRef = useRef<() => LaunchPlan | null>(() =>
		buildPlanRef.current(),
	);
	// Registration is idempotent; the stable resolver always reads the
	// latest plan builder via buildPlanRef.
	useEffect(() => {
		const fn = stableResolverRef.current;
		if (setPlanSource) {
			setPlanSource(fn);
		} else {
			planSource = fn;
		}
	});

	const launchPlan = buildPlan();
	const launchPreview = launchPlan
		? commandLine({ command: launchPlan.command, args: launchPlan.args })
		: "";

	function launchSplitDiagnostic(): boolean {
		if (!config.model?.incomplete) return false;
		bus.emitState("LOG_LINE", {
			stream: "out",
			text: "[SYS] incomplete split group — add the missing parts and rescan [r]",
		});
		return true;
	}

	function yankCommand(): void {
		const plan = buildPlan();
		const result = copyToClipboard({
			text: plan ? commandLine({ command: plan.command, args: plan.args }) : "",
		});
		bus.emitState("LOG_LINE", {
			stream: "out",
			text:
				result.method === "failed"
					? `[SYS] ${result.notice}`
					: `[SYS] command yanked to clipboard (${result.method})`,
		});
	}

	return {
		buildPlan,
		launchPlan,
		launchPreview,
		launchSplitDiagnostic,
		yankCommand,
	};
}
