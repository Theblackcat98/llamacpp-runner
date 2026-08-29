/**
 * Centralized defaults and runtime constants (§3.3, Phase 12).
 * Single source of truth shared by the flag builder, binary validation,
 * estimator, exporters, and configurator so a value never drifts twice.
 * DATA ONLY — no I/O.
 */

/** Managed llama-server binary name (D4: exactly one instance in v1). */
export const LLAMA_SERVER_BIN = "llama-server";

/** Timeout for capturing `llama-server --help` during validation. */
export const HELP_TIMEOUT_MS = 5000;

/** Runtime defaults shared with the flag registry / command preview. */
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8080;
export const DEFAULT_CONTEXT = 4096;
export const DEFAULT_GPU_LAYERS_REF = "meta:block_count+1";

/** Estimator runtime defaults (overhead / compute-buffer envelope). */
export const ESTIMATE_OVERHEAD_LOW = 300 * 1024 * 1024;
export const ESTIMATE_OVERHEAD_HIGH = 800 * 1024 * 1024;
export const ESTIMATE_COMPUTE_MIN_GIB = 0.5;
export const ESTIMATE_COMPUTE_MAX_GIB = 2;
export const ESTIMATE_CTX_BASELINE = 8192;
export const ESTIMATE_BATCH_BASELINE = 2048;
export const ESTIMATE_UBATCH_BASELINE = 512;
