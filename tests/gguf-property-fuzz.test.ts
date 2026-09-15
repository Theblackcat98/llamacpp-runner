import { describe, expect, it } from "bun:test";
import { NeedMoreBytes, ParseError } from "../src/core/gguf/errors";
import { extractModelInfo, parseGgufBytes } from "../src/core/gguf/parser";
import { GgufBuilder, type ScalarTypeName } from "./fixtures/gguf/build";

/**
 * Linear congruential generator (LCG) for deterministic seeded PRNG.
 */
function createSeededRng(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(1664525, s) + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

const SCALAR_TYPES: ScalarTypeName[] = [
	"u8",
	"i8",
	"u16",
	"i16",
	"u32",
	"i32",
	"f32",
	"bool",
	"string",
	"u64",
	"i64",
	"f64",
];

function randomScalarValue(rng: () => number, typeName: ScalarTypeName) {
	switch (typeName) {
		case "u8":
			return Math.floor(rng() * 256);
		case "i8":
			return Math.floor(rng() * 256) - 128;
		case "u16":
			return Math.floor(rng() * 65536);
		case "i16":
			return Math.floor(rng() * 65536) - 32768;
		case "u32":
			return Math.floor(rng() * 1_000_000);
		case "i32":
			return Math.floor(rng() * 1_000_000) - 500_000;
		case "f32":
			return Math.fround(rng() * 100);
		case "f64":
			return rng() * 1000;
		case "bool":
			return rng() > 0.5;
		case "string":
			return `str_${Math.floor(rng() * 100000)}`;
		case "u64":
			return BigInt(Math.floor(rng() * 1_000_000));
		case "i64":
			return BigInt(Math.floor(rng() * 1_000_000) - 500_000);
	}
}

describe("GGUF property-fuzz writer ↔ parser round-trip (#4)", () => {
	it("round-trips synthetic metadata across versions with seeded PRNG in < 1.5s", () => {
		const start = performance.now();
		const rng = createSeededRng(0xdeadbeef);

		const versions: (1 | 2 | 3)[] = [1, 2, 3];
		const iterations = 50;

		for (let iter = 0; iter < iterations; iter++) {
			const version = versions[iter % versions.length] ?? 3;
			const builder = new GgufBuilder().v(version);

			builder.kv("string", "general.architecture", "fuzz_arch");
			builder.kv("u32", "general.file_type", 1);
			builder.kv("u32", "fuzz_arch.context_length", 2048 + (iter % 8) * 512);
			builder.kv("u32", "fuzz_arch.block_count", 16 + (iter % 16));

			const numKvs = 3 + Math.floor(rng() * 6);
			const expectedKvs = new Map<string, unknown>();

			for (let k = 0; k < numKvs; k++) {
				const key = `fuzz.key_${k}`;
				const typeIdx = Math.floor(rng() * SCALAR_TYPES.length);
				const typeName = SCALAR_TYPES[typeIdx] ?? "u32";
				const val = randomScalarValue(rng, typeName);
				builder.kv(typeName, key, val);
				expectedKvs.set(key, val);
			}

			// Add a tensor
			builder.tensor(`tensor_${iter}`, [64, 128]);

			const bytes = builder.build();
			const parsed = parseGgufBytes(bytes);

			expect(parsed.version).toBe(version);
			const info = extractModelInfo(parsed);
			expect(info.architecture).toBe("fuzz_arch");
			expect(info.contextLength).toBe(2048 + (iter % 8) * 512);

			for (const [k, expectedVal] of expectedKvs.entries()) {
				const parsedVal = parsed.kv.get(k);
				if (typeof expectedVal === "number" && !Number.isInteger(expectedVal)) {
					expect(Math.abs((parsedVal as number) - expectedVal)).toBeLessThan(
						0.001,
					);
				} else {
					expect(parsedVal).toEqual(expectedVal as never);
				}
			}
		}

		const elapsed = performance.now() - start;
		expect(elapsed).toBeLessThan(1500);
	});

	it("safely rejects all byte truncations without unhandled exceptions or hangs", () => {
		const builder = new GgufBuilder().v(3);
		builder
			.kv("string", "general.architecture", "fuzz_test")
			.kv("u32", "general.file_type", 7)
			.kvArray("u32", "fuzz_test.array", [1, 2, 3, 4, 5])
			.kv(
				"string",
				"fuzz_test.name",
				"a_very_long_string_payload_for_truncation",
			)
			.tensor("fuzz.weight", [32, 64]);

		const fullBytes = builder.build();

		// Truncate at every single byte offset from 0 up to fullBytes.byteLength - 1
		for (let offset = 0; offset < fullBytes.byteLength; offset++) {
			const sliced = fullBytes.slice(0, offset);
			try {
				parseGgufBytes(sliced);
				throw new Error(
					`Should have thrown error on truncation at offset ${offset}/${fullBytes.byteLength}`,
				);
			} catch (e) {
				const isHandled = e instanceof ParseError || e instanceof NeedMoreBytes;
				expect(isHandled).toBe(true);
			}
		}
	});
});
