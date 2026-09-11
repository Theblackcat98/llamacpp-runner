import { describe, expect, it } from "bun:test";
import {
	classifyFailure,
	FAILURE_PATTERNS,
} from "../src/core/telemetry/failure-classifier";

const OOM_LOG = [
	"llm_load_tensors: offloading 64 repeating layers to GPU",
	"CUDA error: out of memory",
	"llama-server: unable to allocate CUDA0 buffer",
];

const BIND_LOG = ["create_endpoint: bind() failed", "Address already in use"];

const MISSING_LOG = [
	"error loading model: qwen.gguf failed",
	"No such file or directory",
];

describe("classifyFailure (§6.4, P5-FR-07)", () => {
	it("CUDA OOM -> class + suggestion to lower ngl/ctx/kv quant", () => {
		const f = classifyFailure(1, null, OOM_LOG);
		expect(f?.kind).toBe("vram_oom");
		expect(f?.suggestion).toMatch(/ngl/i);
		expect(f?.suggestion).toMatch(/kv|-c\b|context/i);
	});

	it("OOM detected even with exit code 0 pattern mismatch (log wins)", () => {
		const f = classifyFailure(1, null, ["CUDA out of memory"]);
		expect(f?.kind).toBe("vram_oom");
	});

	it("port bind failure -> free-the-port suggestion", () => {
		const f = classifyFailure(1, null, BIND_LOG);
		expect(f?.kind).toBe("bind_failure");
		expect(f?.suggestion).toMatch(/port/i);
	});

	it("missing model file -> re-link/re-scan suggestion", () => {
		const f = classifyFailure(1, null, MISSING_LOG);
		expect(f?.kind).toBe("model_missing");
		expect(f?.suggestion).toMatch(/re-link|re-scan|path/i);
	});

	it("unknown non-zero exit -> generic failure class", () => {
		const f = classifyFailure(3, null, ["something weird happened"]);
		expect(f?.kind).toBe("unknown_error");
		expect(f?.summary.length).toBeGreaterThan(0);
	});

	it("supervisor binary_not_found detail -> actionable class with empty tail", () => {
		const f = classifyFailure(null, null, [], "binary_not_found");
		expect(f?.kind).toBe("binary_not_found");
		expect(f?.suggestion).toMatch(/PATH|binary/i);
	});

	it("supervisor port_in_use detail -> actionable class with empty tail", () => {
		const f = classifyFailure(null, null, [], "port_in_use");
		expect(f?.kind).toBe("port_in_use");
		expect(f?.suggestion).toMatch(/port/i);
	});

	it("supervisor detail wins over log-pattern fallback", () => {
		const f = classifyFailure(1, null, OOM_LOG, "binary_not_found");
		expect(f?.kind).toBe("binary_not_found");
	});

	it("unknown detail falls through to log patterns", () => {
		const f = classifyFailure(1, null, BIND_LOG, "something_future");
		expect(f?.kind).toBe("bind_failure");
	});

	it("clean exit / signal kill -> no classification", () => {
		expect(classifyFailure(0, null, [])).toBeNull();
		expect(classifyFailure(null, "SIGINT", OOM_LOG)).toBeNull();
	});

	it("classification only fires for failure exits (code != 0)", () => {
		expect(classifyFailure(0, null, OOM_LOG)).toBeNull();
	});

	it("every pattern entry has kind, summary, suggestion", () => {
		for (const p of FAILURE_PATTERNS) {
			expect(p.kind.length).toBeGreaterThan(0);
			expect(p.summary.length).toBeGreaterThan(0);
			expect(p.suggestion.length).toBeGreaterThan(0);
		}
	});
});
