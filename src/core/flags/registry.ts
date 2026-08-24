/**
 * Flag registry (§3.3, P4-FR-01): single source of truth for every supported
 * llama-server flag. DATA ONLY — no code paths, no I/O. Consumers: form
 * widgets, command builder, preview, exporters, --help runtime validation.
 */

export type FlagType = "int" | "string" | "bool" | "enum";

export type WidgetKind = "slider" | "checkbox" | "text" | "select";

export type FlagValue = number | string | boolean;

/**
 * `max` may reference model metadata resolved by the builder,
 * e.g. "meta:block_count+1".
 */
export interface FlagEntry {
	id: string;
	cli: [string, ...string[]];
	type: FlagType;
	min?: number;
	max?: number | string;
	/** Allowed values for enum flags. */
	options?: string[];
	default: FlagValue | null;
	since: string;
	deprecated?: boolean;
	ui: { widget: WidgetKind; label: string };
}

export const REGISTRY = {
	n_gpu_layers: {
		id: "n_gpu_layers",
		cli: ["-ngl", "--n-gpu-layers"],
		type: "int",
		min: 0,
		max: "meta:block_count+1",
		default: null,
		since: "b4000",
		ui: { widget: "slider", label: "GPU Offload" },
	},
	ctx_size: {
		id: "ctx_size",
		cli: ["-c", "--ctx-size"],
		type: "int",
		min: 0,
		default: null,
		since: "b4000",
		ui: { widget: "slider", label: "Context Length" },
	},
	batch_size: {
		id: "batch_size",
		cli: ["-b", "--batch-size"],
		type: "int",
		min: 1,
		default: null,
		since: "b4000",
		ui: { widget: "slider", label: "Batch Size" },
	},
	ubatch_size: {
		id: "ubatch_size",
		cli: ["-ub", "--ubatch-size"],
		type: "int",
		min: 1,
		default: null,
		since: "b4000",
		ui: { widget: "slider", label: "Micro-batch Size" },
	},
	threads: {
		id: "threads",
		cli: ["-t", "--threads"],
		type: "int",
		min: 1,
		default: null,
		since: "b4000",
		ui: { widget: "slider", label: "Threads" },
	},
	flash_attn: {
		id: "flash_attn",
		cli: ["-fa", "--flash-attn"],
		type: "bool",
		default: false,
		since: "b4000",
		ui: { widget: "checkbox", label: "Flash Attention" },
	},
	mlock: {
		id: "mlock",
		cli: ["--mlock"],
		type: "bool",
		default: false,
		since: "b4000",
		ui: { widget: "checkbox", label: "mlock" },
	},
	no_mmap: {
		id: "no_mmap",
		cli: ["--no-mmap"],
		type: "bool",
		default: false,
		since: "b4000",
		ui: { widget: "checkbox", label: "no-mmap" },
	},
	cache_type_k: {
		id: "cache_type_k",
		cli: ["-ctk", "--cache-type-k"],
		type: "enum",
		options: ["f16", "q8_0", "q4_0"],
		default: "f16",
		since: "b4000",
		ui: { widget: "select", label: "K Cache" },
	},
	cache_type_v: {
		id: "cache_type_v",
		cli: ["-ctv", "--cache-type-v"],
		type: "enum",
		options: ["f16", "q8_0", "q4_0"],
		default: "f16",
		since: "b4000",
		ui: { widget: "select", label: "V Cache" },
	},
	host: {
		id: "host",
		cli: ["--host", "-H"],
		type: "string",
		default: "127.0.0.1",
		since: "b4000",
		ui: { widget: "text", label: "Host" },
	},
	port: {
		id: "port",
		cli: ["--port"],
		type: "int",
		min: 1024,
		max: 65535,
		default: 8080,
		since: "b4000",
		ui: { widget: "text", label: "Port" },
	},
	chat_template: {
		id: "chat_template",
		cli: ["--chat-template"],
		type: "string",
		default: null,
		since: "b4000",
		ui: { widget: "text", label: "Chat Template" },
	},
	slots: {
		id: "slots",
		cli: ["--slots"],
		type: "bool",
		default: true,
		since: "b4000",
		ui: { widget: "checkbox", label: "Slots endpoint" },
	},
	metrics: {
		id: "metrics",
		cli: ["--metrics"],
		type: "bool",
		default: true,
		since: "b4000",
		ui: { widget: "checkbox", label: "Metrics endpoint" },
	},
	alias: {
		id: "alias",
		cli: ["-a", "--alias"],
		type: "string",
		default: null,
		since: "b4000",
		ui: { widget: "text", label: "Model Alias" },
	},
} satisfies Record<string, FlagEntry>;

export type FlagId = keyof typeof REGISTRY;
export type FlagRegistry = Record<FlagId, FlagEntry>;

/** Deterministic emission order for the builder and form layout. */
export const FLAG_ORDER: FlagId[] = Object.keys(REGISTRY) as FlagId[];

export function getFlag(id: string): FlagEntry | undefined {
	return (REGISTRY as Record<string, FlagEntry>)[id];
}
