import { useEffect, useState } from "react";
import type { createBus } from "../../core/bus";
import type { IntentMap, StateMap } from "../../core/bus-contract";
import {
	type ProbeResult,
	probeBinaryAvailability,
} from "../../core/flags/validate";

type Bus = ReturnType<typeof createBus<IntentMap, StateMap>>;

/**
 * Issue #70: binary capability probe extracted from SessionApp.
 *
 * Issue #15: one binary probe feeds preview AND launch. The resolved
 * binary is probed once per distinct configured path; its --help drives
 * registry availability for every plan built afterwards. A failed or
 * missing capture stays explicitly "unverified" — never silently
 * presented as validated.
 */
export function useBinaryCapability(
	bus: Bus,
	configuredBinaryPath: string | undefined,
): ProbeResult | null {
	const [capability, setCapability] = useState<ProbeResult | null>(null);

	useEffect(() => {
		let cancelled = false;
		void probeBinaryAvailability({ configured: configuredBinaryPath }).then(
			(result) => {
				if (cancelled) return;
				setCapability(result);
				// Issue #15: the unverified state is surfaced explicitly — a
				// missing binary or failed --help capture is never silently
				// presented as capability-validated.
				if (!result.verified) {
					bus.emitState("LOG_LINE", {
						stream: "out",
						text:
							result.resolvedPath === null
								? `[SYS] binary unverified: llama-server not found (${configuredBinaryPath ?? "not on PATH"})`
								: `[SYS] binary unverified: --help capture failed for ${result.resolvedPath}`,
					});
				} else {
					bus.emitState("LOG_LINE", {
						stream: "out",
						text: `[SYS] binary verified: ${result.resolvedPath}`,
					});
				}
			},
		);
		return () => {
			cancelled = true;
		};
	}, [bus, configuredBinaryPath]);

	return capability;
}
