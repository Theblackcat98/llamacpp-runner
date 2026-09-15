/**
 * Configurator state machine (§2.3, P4-FR-06..12, 17): pure logic behind the
 * Launch Configurator screen. Values + clamping + restart-required tracking +
 * preview/VRAM wiring. UI renders state; intents call these functions.
 */

import { DEFAULT_CONTEXT } from "../../core/constants";
import {
	type EstimateInput,
	estimateVram,
	formatBytes,
} from "../../core/estimate/vram";
import { buildCommand, commandLine } from "../../core/flags/builder";
import { REGISTRY } from "../../core/flags/registry";

export interface ConfiguratorModel {
	path: string;
	blockCount?: number;
	contextLength?: number;
	fileSize: number;
	headCount?: number;
	headCountKv?: number;
	embeddingLength?: number;
	keyLength?: number;
}

export interface ConfiguratorState {
	model: ConfiguratorModel | null;
	values: Record<string, unknown>;
	/** Resolved slider max for n_gpu_layers = block_count + 1 (§3.3). */
	nglMax: number;
	/** True once this config has been launched (restart-required arming). */
	launched: boolean;
	/** §3.4: edits to model/ctx/ngl/kv while running require a restart. */
	restartRequired: boolean;
	/** P4-FR-08: set when ctx exceeds the model's context_length. */
	ctxWarning?: string;
}

/** Flags whose edits need a server restart (§3.4). */
export const RESTART_REQUIRED_IDS = [
	"n_gpu_layers",
	"ctx_size",
	"cache_type_k",
	"cache_type_v",
] as const;

export const CTX_CHIPS = [4096, 8192, 16384, 32768, 65536, 131072];
const DEFAULT_CTX = DEFAULT_CONTEXT;

function defaultValues(model: ConfiguratorModel): Record<string, unknown> {
	const values: Record<string, unknown> = {};
	for (const [id, entry] of Object.entries(REGISTRY)) {
		if (entry.default !== null) values[id] = entry.default;
	}
	if (model.blockCount !== undefined) {
		values.n_gpu_layers = model.blockCount + 1;
	}
	values.ctx_size = DEFAULT_CTX;
	return values;
}

export function createConfigurator(
	model: ConfiguratorModel | null,
): ConfiguratorState {
	const nglMax = model?.blockCount === undefined ? 0 : model.blockCount + 1;
	return {
		model,
		values: model ? defaultValues(model) : {},
		nglMax,
		launched: false,
		restartRequired: false,
	};
}

function ctxValueOf(state: ConfiguratorState): number {
	return typeof state.values.ctx_size === "number"
		? (state.values.ctx_size as number)
		: DEFAULT_CTX;
}

// Exported for tests; UI reads state.values directly.
export function ctxValue(state: ConfiguratorState): number {
	return ctxValueOf(state);
}

export function setFlag(
	state: ConfiguratorState,
	id: string,
	value: unknown,
): ConfiguratorState {
	const restartIds = RESTART_REQUIRED_IDS as readonly string[];
	return {
		...state,
		values: { ...state.values, [id]: value },
		restartRequired:
			state.restartRequired || (state.launched && restartIds.includes(id)),
	};
}

/**
 * Clamp ctx to {arch}.context_length with an explicit warning on exceed
 * (P4-FR-08). No-op when the model lacks context metadata.
 */
export function clampContext(state: ConfiguratorState): ConfiguratorState {
	const max = state.model?.contextLength;
	if (max === undefined) return state;
	const current = ctxValueOf(state);
	if (current > max) {
		return {
			...state,
			values: { ...state.values, ctx_size: max },
			ctxWarning: `clamped to ${max} (model context_length)`,
		};
	}
	return { ...state, ctxWarning: undefined };
}

export function resetConfigurator(state: ConfiguratorState): ConfiguratorState {
	return createConfigurator(state.model);
}

/**
 * Phase 13: load a saved preset's flags into the configurator. Preserves the
 * selected model (or the preset's model path) and replaces values wholesale;
 * nudges nglMax to keep the slider in range. Returns a fresh state so
 * restart-required/ctx warnings reset on load.
 */
export function loadPresetInto(
	state: ConfiguratorState,
	values: Record<string, unknown>,
	modelPath?: string,
): ConfiguratorState {
	const model =
		modelPath !== undefined
			? state.model && state.model.path === modelPath
				? state.model
				: { ...(state.model ?? { fileSize: 0 }), path: modelPath }
			: (state.model ?? null);
	const nglMax = model?.blockCount === undefined ? 0 : model.blockCount + 1;
	const merged = { ...effectiveValues(state), ...values };
	if (typeof merged.n_gpu_layers !== "number") {
		merged.n_gpu_layers = nglMax;
	}
	return {
		model,
		values: merged,
		nglMax,
		launched: false,
		restartRequired: false,
	};
}

/** Effective builder inputs: user values overlaying registry defaults. */
export function effectiveValues(
	state: ConfiguratorState,
): Record<string, unknown> {
	const merged: Record<string, unknown> = {};
	for (const entry of Object.values(REGISTRY)) {
		if (entry.default !== null && entry.default !== false) {
			merged[entry.id] = entry.default;
		}
	}
	return { ...merged, ...state.values };
}

/** Deterministic argv for the live preview strip (P4-FR-06, NFR-01). */
export function previewArgs(state: ConfiguratorState): string[] {
	if (!state.model) return [];
	return buildCommand({
		modelPath: state.model.path,
		meta: { blockCount: state.model.blockCount },
		values: effectiveValues(state),
	}).args;
}

export function previewLine(state: ConfiguratorState): string {
	if (!state.model) return "";
	const built = buildCommand({
		modelPath: state.model.path,
		meta: { blockCount: state.model.blockCount },
		values: effectiveValues(state),
	});
	return commandLine(built);
}

/** Numeric VRAM estimate range for telemetry actual-vs-estimated (F12). */
export function vramRangeBytes(
	state: ConfiguratorState,
): { low: number; high: number } | null {
	const m = state.model;
	if (
		!m ||
		m.blockCount === undefined ||
		!m.headCount ||
		m.headCountKv === undefined ||
		!m.embeddingLength
	) {
		return null;
	}
	const input: EstimateInput = {
		fileSize: m.fileSize,
		blockCount: m.blockCount,
		contextLength: ctxValueOf(state),
		headCount: m.headCount,
		headCountKv: m.headCountKv,
		embeddingLength: m.embeddingLength,
		keyLength: m.keyLength,
		gpuLayers:
			typeof state.values.n_gpu_layers === "number"
				? (state.values.n_gpu_layers as number)
				: state.nglMax,
		kvQuantK: kvQuantValue(state, "cache_type_k"),
		kvQuantV: kvQuantValue(state, "cache_type_v"),
	};
	return estimateVram(input).range;
}

/** VRAM estimate text wired to ngl/ctx/KV precision (P4-FR-07). */
export function vramRangeText(state: ConfiguratorState): string | null {
	const range = vramRangeBytes(state);
	if (!range) return null;
	return `${formatBytes(range.low)} – ${formatBytes(range.high)} (estimated range)`;
}

export type KvQuant = "f16" | "q8_0" | "q4_0";

export function kvQuantValue(state: ConfiguratorState, id: string): KvQuant {
	const v = state.values[id];
	return v === "q8_0" ? "q8_0" : v === "q4_0" ? "q4_0" : "f16";
}
