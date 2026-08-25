import type { SlotSample } from "../../core/telemetry/slots";
import { sparkline } from "../../core/telemetry/sparkline";
import type { TelemetryPhase } from "../../core/telemetry/state-machine";

export type BadgeClass = "ok" | "warn" | "error";

export interface TelemetryInputs {
	phase: TelemetryPhase;
	model: string | null;
	endpoint: string | null;
	startedAtMs: number | null;
	nowMs: number;
	telemetryEnabled: boolean;
	vramEstimatedBytes: { low: number; high: number } | null;
	memUsedBytes: number | null;
	kvUsageRatio: number | null;
	promptHistory: number[];
	decodeHistory: number[];
	slots: SlotSample[];
	failure: { summary: string; suggestion?: string } | null;
	tailLines: string[];
}

export interface TelemetryViewModel {
	badge: BadgeClass;
	statusLabel: string;
	uptime: string;
	modelLabel: string;
	endpointLabel: string;
	vramFraction: number;
	vramLabel: string;
	kvFraction: number;
	promptSpark: string;
	decodeSpark: string;
	promptTpsLabel: string;
	decodeTpsLabel: string;
	slotRows: string[][];
	dormant: boolean;
	failureSummary: string | null;
	failureSuggestion: string | null;
	errorTail: string[];
}

const BADGE: Record<TelemetryPhase, BadgeClass> = {
	IDLE: "warn",
	STARTING: "warn",
	LOADING: "warn",
	READY: "ok",
	FAILED: "error",
};

export function formatUptime(ms: number): string {
	const total = Math.floor(ms / 1000);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	if (h > 0) return `${h}h ${m}m ${s}s`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}

function gb(bytes: number): string {
	return `${(bytes / 1e9).toFixed(1)} GB`;
}

export function buildTelemetryViewModel(
	inputs: TelemetryInputs,
): TelemetryViewModel {
	const {
		phase,
		model,
		endpoint,
		startedAtMs,
		nowMs,
		telemetryEnabled,
		vramEstimatedBytes,
		memUsedBytes,
		kvUsageRatio,
		promptHistory,
		decodeHistory,
		slots,
		failure,
		tailLines,
	} = inputs;

	let vramFraction = 0;
	let vramLabel = "no VRAM data";
	if (vramEstimatedBytes && memUsedBytes !== null) {
		vramFraction = Math.min(memUsedBytes / vramEstimatedBytes.high, 1);
		vramLabel = `${gb(memUsedBytes)} actual / ${gb(vramEstimatedBytes.high)} est`;
	}
	let kvFraction = 0;
	if (kvUsageRatio !== null)
		kvFraction = Math.min(Math.max(kvUsageRatio, 0), 1);

	const last = <A>(xs: A[]): A | null =>
		xs.length > 0 ? (xs[xs.length - 1] ?? null) : null;
	const promptLast = last(promptHistory);
	const decodeLast = last(decodeHistory);

	const slotRows = slots.map((s) => [
		String(s.id),
		s.state,
		s.promptTokens === null ? "-" : String(s.promptTokens),
		s.generating ? "*" : "",
	]);

	const failed = phase === "FAILED";

	return {
		badge: BADGE[phase],
		statusLabel: phase,
		uptime: startedAtMs === null ? "-" : formatUptime(nowMs - startedAtMs),
		modelLabel: model ?? "(no model)",
		endpointLabel: endpoint ?? "-",
		vramFraction,
		vramLabel,
		kvFraction,
		promptSpark: sparkline(promptHistory, 24),
		decodeSpark: sparkline(decodeHistory, 24),
		promptTpsLabel:
			promptLast === null
				? "prompt t/s: -"
				: `prompt t/s: ${promptLast.toFixed(1)}`,
		decodeTpsLabel:
			decodeLast === null
				? "decode t/s: -"
				: `decode t/s: ${decodeLast.toFixed(1)}`,
		slotRows,
		dormant: !telemetryEnabled,
		failureSummary: failed ? (failure?.summary ?? "server failed") : null,
		failureSuggestion: failed ? (failure?.suggestion ?? null) : null,
		errorTail: failed ? tailLines.slice(-50) : [],
	};
}
