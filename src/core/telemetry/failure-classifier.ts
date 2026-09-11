/**
 * Failure classification (§6.4, P5-FR-07): exit code + log patterns for CUDA
 * OOM, port bind failure, missing model file. Each class carries a summary
 * and a suggested fix surfaced on the FAILED state (last-50-lines tail).
 */
export type FailureKind =
	| "vram_oom"
	| "bind_failure"
	| "model_missing"
	| "binary_not_found"
	| "port_in_use"
	| "spawn_error"
	| "unknown_error";

export interface FailurePattern {
	kind: Exclude<FailureKind, "unknown_error">;
	/** Case-insensitive regex matched against assembled log lines. */
	pattern: RegExp;
	summary: string;
	suggestion: string;
}

export const FAILURE_PATTERNS: FailurePattern[] = [
	{
		kind: "vram_oom",
		pattern:
			/out of memory|out_of_memory|cuda error|cudaMalloc|failed to allocate/i,
		summary: "CUDA out of memory during model load (OOM)",
		suggestion:
			"Lower -ngl (GPU offload) or -c (context), or switch KV cache to q8_0/q4_0",
	},
	{
		kind: "bind_failure",
		pattern:
			/address already in use|bind\(\) failed|failed to bind|EADDRINUSE/i,
		summary: "Port bind failed — another process holds the endpoint",
		suggestion:
			"Free the port or pick a different --port (pre-flight suggests one)",
	},
	{
		kind: "model_missing",
		pattern:
			/no such file or directory|failed to open|error loading model|unable to open file/i,
		summary: "Model file missing or unreadable",
		suggestion: "Re-scan models dir and re-link the preset path",
	},
];

export interface ClassifiedFailure {
	kind: FailureKind;
	summary: string;
	suggestion: string;
}

/**
 * Classify a server failure from exit code + log tail. The supervisor's
 * pre-spawn `detail` (binary_not_found / port_in_use / spawn_error, §7) is
 * authoritative and wins over log patterns: those FAILED events carry no
 * exit code and an empty tail, so without it they degrade to a generic
 * "exited with code 1" (F6).
 */
export function classifyFailure(
	exitCode: number | null,
	signal: string | null,
	logTail: string[],
	detail?: string | null,
): ClassifiedFailure | null {
	if (detail === "binary_not_found")
		return {
			kind: "binary_not_found",
			summary: "llama-server binary not found on PATH",
			suggestion: "Install llama-server on PATH or set binary_path, then retry",
		};
	if (detail === "port_in_use")
		return {
			kind: "port_in_use",
			summary: "Port already in use — spawn refused before launch",
			suggestion:
				"Free the port or pick a different --port (pre-flight suggests one)",
		};
	if (detail === "spawn_error")
		return {
			kind: "spawn_error",
			summary: "Failed to spawn the llama-server process",
			suggestion: "Check the binary path and execute permissions, then retry",
		};
	if (signal !== null) return null;
	if (exitCode === null || exitCode === 0) return null;

	for (const p of FAILURE_PATTERNS) {
		const hit = logTail.some((line) => p.pattern.test(line));
		if (hit)
			return { kind: p.kind, summary: p.summary, suggestion: p.suggestion };
	}
	return {
		kind: "unknown_error",
		summary: `llama-server exited with code ${exitCode}`,
		suggestion: "Inspect the last log lines for details",
	};
}
