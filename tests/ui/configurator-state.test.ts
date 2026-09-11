import { describe, expect, it } from "bun:test";
import {
	type ConfiguratorModel,
	CTX_CHIPS,
	clampContext,
	createConfigurator,
	ctxValue,
	effectiveValues,
	loadPresetInto,
	previewLine,
	resetConfigurator,
	setFlag,
	vramRangeBytes,
	vramRangeText,
} from "../../src/ui/logic/configurator-state";

const MODEL: ConfiguratorModel = {
	path: "~/models/qwen.gguf",
	blockCount: 64,
	contextLength: 32768,
	fileSize: 20 * 1024 ** 3,
	headCount: 40,
	headCountKv: 8,
	embeddingLength: 5120,
};

/** P4-FR-06..12, P4-FR-17: configurator state machine behaviors. */
describe("createConfigurator", () => {
	it("starts with registry defaults and resolved ngl max", () => {
		const cfg = createConfigurator(MODEL);
		expect(cfg.values.host).toBe("127.0.0.1");
		expect(cfg.values.port).toBe(8080);
		expect(cfg.nglMax).toBe(65);
		expect(ctxValue(cfg)).toBe(4096);
		expect(cfg.restartRequired).toBe(false);
	});

	it("ctx preset chips span 4096..131072 (P4-FR-08)", () => {
		expect(CTX_CHIPS[0]).toBe(4096);
		expect(CTX_CHIPS[CTX_CHIPS.length - 1]).toBe(131072);
	});
});

describe("setFlag + clampContext (P4-FR-08)", () => {
	it("clamps ctx to arch context_length and raises warning", () => {
		let cfg = createConfigurator(MODEL);
		cfg = setFlag(cfg, "ctx_size", 131072);
		cfg = clampContext(cfg);
		expect(ctxValue(cfg)).toBe(32768);
		expect(cfg.ctxWarning).toContain("32768");
	});

	it("clears the warning once back inside range", () => {
		let cfg = createConfigurator(MODEL);
		cfg = setFlag(cfg, "ctx_size", 65536);
		cfg = clampContext(cfg);
		cfg = setFlag(cfg, "ctx_size", 8192);
		cfg = clampContext(cfg);
		expect(ctxValue(cfg)).toBe(8192);
		expect(cfg.ctxWarning).toBeUndefined();
	});
});

describe("restart-required semantics (P4-FR-12)", () => {
	it("edits to ctx/ngl/model/kv after launch are marked restart required", () => {
		const base = { ...createConfigurator(MODEL), launched: true };
		const marked = setFlag(base, "ctx_size", 8192);
		expect(marked.restartRequired).toBe(true);
	});

	it("cosmetic edits (alias/host) never mark restart required", () => {
		const base = { ...createConfigurator(MODEL), launched: true };
		const edited = setFlag(base, "alias", "qwen");
		expect(edited.restartRequired).toBe(false);
	});

	it("Esc reset returns to defaults and clears markers (P4-FR-17)", () => {
		let cfg = createConfigurator(MODEL);
		cfg = setFlag(cfg, "ctx_size", 16384);
		cfg = setFlag({ ...cfg, launched: true }, "n_gpu_layers", 32);
		const resetted = resetConfigurator(cfg);
		expect(ctxValue(resetted)).toBe(4096);
		expect(resetted.restartRequired).toBe(false);
	});
});

describe("live preview (P4-FR-06)", () => {
	it("updates deterministically on every value change", () => {
		let cfg = createConfigurator(MODEL);
		const before = previewLine(cfg);
		cfg = setFlag(cfg, "flash_attn", true);
		const after = previewLine(cfg);
		expect(after).not.toBe(before);
		expect(previewLine(cfg)).toBe(after);
		expect(after).toContain("--flash-attn");
	});

	it("effective values merge defaults for the builder", () => {
		const cfg = createConfigurator(MODEL);
		const eff = effectiveValues(cfg);
		expect(eff.n_gpu_layers).toBe(65);
		expect(eff.ctx_size).toBe(4096);
	});
});

describe("VRAM wiring (P4-FR-07)", () => {
	it("range recomputes as ngl/ctx/KV change", () => {
		let cfg = createConfigurator(MODEL);
		cfg = setFlag(cfg, "n_gpu_layers", 65);
		const full = vramRangeText(cfg);
		cfg = setFlag(cfg, "n_gpu_layers", 10);
		const low = vramRangeText(cfg);
		expect(full).toMatch(/estimated range/i);
		expect(low).not.toBe(full);
	});

	it("vramRangeBytes returns the numeric range behind the label (F12)", () => {
		const cfg = createConfigurator(MODEL);
		const range = vramRangeBytes(cfg);
		expect(range).not.toBeNull();
		expect(range?.low).toBeGreaterThan(0);
		expect(range?.high).toBeGreaterThanOrEqual(range?.low ?? 0);
	});

	it("vramRangeBytes is null without model metadata (F12)", () => {
		expect(vramRangeBytes(createConfigurator(null))).toBeNull();
	});
});

describe("loadPresetInto (Phase 13)", () => {
	it("replaces values wholesale and resets launch markers", () => {
		let cfg = createConfigurator(MODEL);
		cfg = { ...cfg, launched: true, restartRequired: true };
		const loaded = loadPresetInto(cfg, {
			ctx_size: 16384,
			flash_attn: true,
			alias: "qwen-preset",
		});
		expect(loaded.values.ctx_size).toBe(16384);
		expect(loaded.values.flash_attn).toBe(true);
		expect(loaded.values.alias).toBe("qwen-preset");
		expect(loaded.launched).toBe(false);
		expect(loaded.restartRequired).toBe(false);
	});

	it("keeps the selected model and clamps ngl max when unset", () => {
		const cfg = createConfigurator(MODEL);
		const loaded = loadPresetInto(cfg, { ctx_size: 8192 });
		expect(loaded.model?.path).toBe(MODEL.path);
		expect(loaded.nglMax).toBe(65);
		expect(loaded.values.n_gpu_layers).toBe(65);
	});

	it("preserves explicitly stored ngl from the preset", () => {
		const cfg = createConfigurator(MODEL);
		const loaded = loadPresetInto(cfg, { n_gpu_layers: 10, ctx_size: 4096 });
		expect(loaded.values.n_gpu_layers).toBe(10);
	});
});
