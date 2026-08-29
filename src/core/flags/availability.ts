/**
 * Availability-aware command safety (Phase 12, §3.3, D9):
 * when runtime `--help` validation has run against the selected binary we can
 * (a) refuse flags the binary does not provide, and (b) warn on deprecated
 * flags — so an unavailable/deprecated flag can never launch accidentally.
 *
 * Pure: takes the availability map produced by `registryAvailability` and a
 * set of requested flag ids; returns what must be dropped vs merely flagged.
 */
import type { FlagAvailability } from "./help-parser";
import { getFlag } from "./registry";

export type BlockReason = "unsupported" | "deprecated";

export interface AvailabilityVerdict {
	/** Flags that MUST be dropped before building argv. */
	dropped: Array<{ id: string; reason: BlockReason; cli: string }>;
	/** Flags that still build but carry a warning. */
	warned: Array<{ id: string; reason: BlockReason; cli: string }>;
	/** Flags the binary simply doesn't understand (count of requested). */
	unsupportedCount: number;
}

export const UNAVAILABLE_HINT =
	"not supported by this llama-server binary — remove it or upgrade the binary";

/**
 * Decide which requested flags are safe to build. `availability` is the map
 * from `registryAvailability`. When omitted or when the map reports a flag as
 * available, the flag builds normally.
 *
 * Semantics (Phase 12):
 *  - unsupported  -> dropped (cannot launch)
 *  - deprecated   -> warned (builds, so power users keep working, but flagged)
 */
export function assessAvailability(
	requestedIds: Iterable<string>,
	availability: Record<string, FlagAvailability>,
): AvailabilityVerdict {
	const dropped: AvailabilityVerdict["dropped"] = [];
	const warned: AvailabilityVerdict["warned"] = [];
	let unsupportedCount = 0;

	for (const id of requestedIds) {
		const entry = getFlag(id);
		if (!entry) continue;
		const cli = entry.cli[1] ?? entry.cli[0];
		const avail = availability[id];
		if (!avail) continue; // unknown to validation -> don't guess, keep
		if (!avail.supported) {
			dropped.push({ id, reason: "unsupported", cli });
			unsupportedCount++;
			continue;
		}
		if (avail.deprecated) {
			warned.push({ id, reason: "deprecated", cli });
		}
	}

	return { dropped, warned, unsupportedCount };
}
