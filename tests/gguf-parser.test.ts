import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ParseError } from "../src/core/gguf/errors";
import {
	computeEffectiveBpw,
	extractModelInfo,
	parseGgufBytes,
	parseGgufFile,
} from "../src/core/gguf/parser";
import { quantName } from "../src/core/gguf/quant-map";
import { GgufBuilder } from "./fixtures/gguf/build";

describe("GGUF parser: header validation (P3-FR-01)", () => {
	it("rejects bad magic with BAD_MAGIC", () => {
		const buf = new Uint8Array(24);
		buf[0] = 0x47;
		expect(() => parseGgufBytes(buf)).toThrow(ParseError);
		try {
			parseGgufBytes(buf);
		} catch (e) {
			expect((e as ParseError).code).toBe("BAD_MAGIC");
		}
	});

	it("rejects version 4 with UNSUPPORTED_VERSION", () => {
		const b = new GgufBuilder().v(4 as 3);
		b.kv("string", "general.architecture", "llama").tensor("t", [2, 2]);
		try {
			parseGgufBytes(b.build());
			throw new Error("should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(ParseError);
			expect((e as ParseError).code).toBe("UNSUPPORTED_VERSION");
		}
	});

	it("flags a stream cut mid-KV as TRUNCATED", () => {
		const b = new GgufBuilder();
		b.kv("string", "general.architecture", "llama")
			.kv("u32", "general.file_type", 15)
			.tensor("token_embd.weight", [2048, 32000]);
		const full = b.build();
		const cut = full.slice(0, full.byteLength - 10);
		expect(() => parseGgufBytes(cut)).toThrow(ParseError);
	});
});

describe("GGUF parser: v1/v2/v3 integer widths (P3-FR-02)", () => {
	it("parses v3 u64 counts and lengths", () => {
		const b = new GgufBuilder().v(3);
		b.kv("string", "general.architecture", "qwen2")
			.kv("u64", "big.count", 9007199254740993n)
			.tensor("token_embd.weight", [1024, 151936]);
		const h = parseGgufBytes(b.build());
		expect(h.version).toBe(3);
		expect(h.kv.get("big.count")).toBe(9007199254740993n);
	});

	it("parses v1 u32 path", () => {
		const b = new GgufBuilder().v(1);
		b.kv("string", "general.architecture", "llama")
			.kv("u32", "general.file_type", 15)
			.tensor("token_embd.weight", [2048, 32000]);
		const h = parseGgufBytes(b.build());
		expect(h.version).toBe(1);
		expect(h.kv.get("general.architecture")).toBe("llama");
		expect(h.tensors.length).toBe(1);
	});

	it("accepts v2", () => {
		const b = new GgufBuilder().v(2);
		b.kv("string", "general.architecture", "llama").tensor("t.weight", [4]);
		const h = parseGgufBytes(b.build());
		expect(h.version).toBe(2);
	});
});

describe("GGUF parser: full KV value-type support (P3-FR-03)", () => {
	function buildAll() {
		const b = new GgufBuilder();
		return b
			.kv("u8", "k.u8", 255)
			.kv("i8", "k.i8", -128)
			.kv("u16", "k.u16", 65535)
			.kv("i16", "k.i16", -32768)
			.kv("u32", "k.u32", 4294967295)
			.kv("i32", "k.i32", -2147483648)
			.kv("f32", "k.f32", 1.5)
			.kv("bool", "k.bool", true)
			.kv("string", "k.str", "hello")
			.kv("u64", "k.u64", 18446744073709551615n)
			.kv("i64", "k.i64", -9223372036854775808n)
			.kv("f64", "k.f64", 0.25)
			.kvArray("string", "k.arrstr", ["a", "bb", "ccc"])
			.kvArray("i32", "k.arri32", [1, -2, 3])
			.kvArray("f32", "k.arrf32", [0.5, 0.75])
			.kvArray("bool", "k.arrbool", [true, false])
			.tensor("t.weight", [2, 3]);
	}

	it("round-trips scalars 0..7 and string (8)", () => {
		const h = parseGgufBytes(buildAll().build());
		expect(h.kv.get("k.u8")).toBe(255);
		expect(h.kv.get("k.i8")).toBe(-128);
		expect(h.kv.get("k.u16")).toBe(65535);
		expect(h.kv.get("k.i16")).toBe(-32768);
		expect(h.kv.get("k.u32")).toBe(4294967295);
		expect(h.kv.get("k.i32")).toBe(-2147483648);
		expect(h.kv.get("k.f32")).toBeCloseTo(1.5, 5);
		expect(h.kv.get("k.bool")).toBe(true);
		expect(h.kv.get("k.str")).toBe("hello");
	});

	it("round-trips u64/i64/f64 (10..12)", () => {
		const h = parseGgufBytes(buildAll().build());
		expect(h.kv.get("k.u64")).toBe(18446744073709551615n);
		expect(h.kv.get("k.i64")).toBe(-9223372036854775808n);
		expect(h.kv.get("k.f64")).toBeCloseTo(0.25, 12);
	});

	it("round-trips arrays incl. string arrays (9)", () => {
		const h = parseGgufBytes(buildAll().build());
		const strs = h.kv.get("k.arrstr");
		expect(strs).toMatchObject({
			itemType: "string",
			values: ["a", "bb", "ccc"],
		});
		expect(h.kv.get("k.arri32")).toMatchObject({
			itemType: "i32",
			values: [1, -2, 3],
		});
		expect(h.kv.get("k.arrbool")).toMatchObject({
			itemType: "bool",
			values: [true, false],
		});
		const f32s = h.kv.get("k.arrf32");
		expect(f32s).toMatchObject({ itemType: "f32" });
		const vals = (f32s as { values: number[] }).values;
		expect(vals[0]).toBeCloseTo(0.5, 5);
		expect(vals[1]).toBeCloseTo(0.75, 5);
	});
});

describe("GGUF parser: metadata extraction (P3-FR-04)", () => {
	it("extracts the llama.* key family", () => {
		const b = new GgufBuilder();
		b.kv("string", "general.architecture", "llama")
			.kv("u32", "general.file_type", 15)
			.kv("u32", "llama.context_length", 2048)
			.kv("u32", "llama.block_count", 22)
			.kv("u32", "llama.embedding_length", 2048)
			.kv("u32", "llama.attention.head_count", 32)
			.kv("u32", "llama.attention.head_count_kv", 4)
			.kv("u32", "llama.vocab_size", 32000)
			.tensor("token_embd.weight", [2048, 32000]);
		const info = extractModelInfo(parseGgufBytes(b.build()));
		expect(info.architecture).toBe("llama");
		expect(info.quantName).toBe("Q4_K_M");
		expect(info.contextLength).toBe(2048);
		expect(info.blockCount).toBe(22);
		expect(info.embeddingLength).toBe(2048);
		expect(info.headCount).toBe(32);
		expect(info.headCountKv).toBe(4);
		expect(info.keyLength).toBeUndefined();
		expect(info.vocabSize).toBe(32000);
	});

	it("extracts gemma key_length when present", () => {
		const b = new GgufBuilder();
		b.kv("string", "general.architecture", "gemma3")
			.kv("u32", "gemma3.attention.key_length", 256)
			.tensor("token_embd.weight", [2560, 262144]);
		const info = extractModelInfo(parseGgufBytes(b.build()));
		expect(info.keyLength).toBe(256);
	});

	it("maps file_type via quant-map table", () => {
		expect(quantName(15)).toBe("Q4_K_M");
		expect(quantName(0)).toBe("F32");
		expect(quantName(7)).toBe("Q8_0");
		expect(quantName(28)).toBe("IQ4_XS");
		expect(quantName(99)).toMatch(/^UNKNOWN/);
	});
});

describe("GGUF parser: exact params + effective bpw (P3-FR-05/06)", () => {
	it("sums dim products across tensor_infos exactly", () => {
		const b = new GgufBuilder();
		b.kv("string", "general.architecture", "llama")
			.tensor("token_embd.weight", [2048, 32000])
			.tensor("blk.0.attn_q.weight", [2048, 2048])
			.tensor("output.weight", [32000, 2048]);
		const h = parseGgufBytes(b.build());
		expect(extractModelInfo(h).totalParams).toBe(
			2048 * 32000 + 2048 * 2048 + 32000 * 2048,
		);
	});

	it("computes effective bpw from file size and params", () => {
		const params = 1_000_000_000;
		expect(computeEffectiveBpw(params, 500_000_000)).toBeCloseTo(4.0, 6);
	});
});

describe("GGUF parser: streaming cap + retry (P3-FR-07)", () => {
	function tmpDir(label: string): string {
		return mkdtempSync(join(tmpdir(), `gguf-${label}-`));
	}

	it("parses a real temp file end-to-end", async () => {
		const { sampleLlamaQ4Km } = await import("./fixtures/gguf/build");
		const { buffer } = sampleLlamaQ4Km();
		const path = join(tmpDir("basic"), "m.gguf");
		await Bun.write(path, buffer);
		const h = await parseGgufFile(path);
		expect(h.version).toBe(3);
	});

	it("safety valve: parses a 3MB huge-vocab header (real qwen/gemma scale)", async () => {
		const b = new GgufBuilder();
		b.kv("string", "general.architecture", "qwen2")
			.kv("string", "tokenizer.ggml.tokens", "x".repeat(3 * 1024 * 1024))
			.tensor("t.weight", [4]);
		const path = join(tmpDir("valve"), "hugevocab.gguf");
		await Bun.write(path, b.build());
		const h = await parseGgufFile(path);
		expect(h.kv.get("general.architecture")).toBe("qwen2");
	});

	it("retries at 2MB when the header spans the 256KB cap", async () => {
		const b = new GgufBuilder();
		b.kv("string", "general.architecture", "llama")
			.kv("string", "big.blob", "x".repeat(300 * 1024))
			.tensor("t.weight", [4]);
		const path = join(tmpDir("retry"), "big.gguf");
		await Bun.write(path, b.build());
		const h = await parseGgufFile(path);
		expect(h.kv.get("general.architecture")).toBe("llama");
	});

	it("throws HEADER_TOO_LARGE beyond the 2MB retry cap", async () => {
		const b = new GgufBuilder();
		b.kv("string", "general.architecture", "llama")
			.kv("string", "big.blob", "x".repeat(33 * 1024 * 1024))
			.tensor("t.weight", [4]);
		const path = join(tmpDir("oversize"), "huge.gguf");
		await Bun.write(path, b.build());
		try {
			await parseGgufFile(path);
			throw new Error("should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(ParseError);
			expect((e as ParseError).code).toBe("HEADER_TOO_LARGE");
		}
	});

	it("throws TRUNCATED when the file ends inside its header", async () => {
		const { sampleLlamaQ4Km } = await import("./fixtures/gguf/build");
		const { buffer } = sampleLlamaQ4Km();
		const path = join(tmpDir("trunc"), "cut.gguf");
		await Bun.write(path, buffer.slice(0, buffer.byteLength - 5));
		try {
			await parseGgufFile(path);
			throw new Error("should have thrown");
		} catch (e) {
			expect((e as ParseError).code).toBe("TRUNCATED");
		}
	});
});
