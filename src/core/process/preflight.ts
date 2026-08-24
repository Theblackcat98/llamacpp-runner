/**
 * Launch pre-flight guards (§3.4, §7; P4-FR-09/10): host confirmation gate
 * and port bind check with next-free-port suggestion.
 */
import { checkPortFree } from "./supervisor";

/**
 * P4-FR-09: binding 0.0.0.0 exposes the server on all interfaces; any launch
 * against it must pass an explicit user confirmation first.
 */
export function requiresHostConfirmation(host: string | undefined): boolean {
	return host === "0.0.0.0";
}

export interface PreflightResult {
	free: boolean;
	/** Next free port when the requested one is taken (§7). */
	suggested?: number;
}

export async function findNextFreePort(
	requested: number,
	host = "127.0.0.1",
	maxTries = 10,
): Promise<PreflightResult> {
	if (await checkPortFree(requested, host)) {
		return { free: true };
	}
	for (
		let candidate = requested + 1;
		candidate < requested + maxTries;
		candidate++
	) {
		if (await checkPortFree(candidate, host)) {
			return { free: false, suggested: candidate };
		}
	}
	return { free: false };
}
