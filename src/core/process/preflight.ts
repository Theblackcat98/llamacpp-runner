/** Launch pre-flight guards (§3.4, §7; P4-FR-09/10). */
import { checkPortFree } from "./supervisor";

/** Public/wildcard bindings require explicit confirmation; loopback does not. */
export function requiresHostConfirmation(host: string | undefined): boolean {
	if (!host) return false;
	const normalized = host.trim().toLowerCase();
	return (
		normalized === "0.0.0.0" ||
		normalized === "::" ||
		normalized === "[::]" ||
		normalized === "::0"
	);
}

export interface PreflightResult {
	free: boolean;
	suggested?: number;
}
export async function findNextFreePort(
	requested: number,
	host = "127.0.0.1",
	maxTries = 10,
): Promise<PreflightResult> {
	if (await checkPortFree(requested, host)) return { free: true };
	for (
		let candidate = requested + 1;
		candidate < requested + maxTries;
		candidate++
	)
		if (await checkPortFree(candidate, host))
			return { free: false, suggested: candidate };
	return { free: false };
}
