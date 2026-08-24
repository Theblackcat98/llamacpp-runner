import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type ScalarTypeName =
	| "u8"
	| "i8"
	| "u16"
	| "i16"
	| "u32"
	| "i32"
	| "f32"
	| "bool"
	| "string"
	| "u64"
	| "i64"
	| "f64";

export type ValueTypeName = ScalarTypeName | "array";

export const VALUE_TYPE_ID: Record<ValueTypeName, number> = {
	u8: 0,
	i8: 1,
	u16: 2,
	i16: 3,
	u32: 4,
	i32: 5,
	f32: 6,
	bool: 7,
	string: 8,
	array: 9,
	u64: 10,
	i64: 11,
	f64: 12,
};

export type PrimitiveValue = number | bigint | string | boolean;

export interface ArrayValue {
	itemType: ScalarTypeName;
	values: PrimitiveValue[];
}

type KvEntry = {
	key: string;
	typeName: ValueTypeName;
	value: PrimitiveValue | ArrayValue;
};

interface Writable {
	byteLength(): number;
	write(view: DataView, offset: number): number;
}

function scalarWriter(
	typeName: ScalarTypeName,
	value: PrimitiveValue,
): Writable {
	switch (typeName) {
		case "u8":
			return {
				byteLength: () => 1,
				write: (v, o) => {
					v.setUint8(o, Number(value));
					return 1;
				},
			};
		case "i8":
			return {
				byteLength: () => 1,
				write: (v, o) => {
					v.setInt8(o, Number(value));
					return 1;
				},
			};
		case "u16":
			return {
				byteLength: () => 2,
				write: (v, o) => {
					v.setUint16(o, Number(value), true);
					return 2;
				},
			};
		case "i16":
			return {
				byteLength: () => 2,
				write: (v, o) => {
					v.setInt16(o, Number(value), true);
					return 2;
				},
			};
		case "u32":
			return {
				byteLength: () => 4,
				write: (v, o) => {
					v.setUint32(o, Number(value), true);
					return 4;
				},
			};
		case "i32":
			return {
				byteLength: () => 4,
				write: (v, o) => {
					v.setInt32(o, Number(value), true);
					return 4;
				},
			};
		case "u64":
			return {
				byteLength: () => 8,
				write: (v, o) => {
					v.setBigUint64(o, BigInt(value), true);
					return 8;
				},
			};
		case "i64":
			return {
				byteLength: () => 8,
				write: (v, o) => {
					v.setBigInt64(o, BigInt(value), true);
					return 8;
				},
			};
		case "f32":
			return {
				byteLength: () => 4,
				write: (v, o) => {
					v.setFloat32(o, Number(value), true);
					return 4;
				},
			};
		case "f64":
			return {
				byteLength: () => 8,
				write: (v, o) => {
					v.setFloat64(o, Number(value), true);
					return 8;
				},
			};
		case "bool":
			return {
				byteLength: () => 1,
				write: (v, o) => {
					v.setUint8(o, value ? 1 : 0);
					return 1;
				},
			};
		case "string": {
			const bytes = Buffer.from(String(value), "utf8");
			return {
				byteLength: () => bytes.byteLength,
				write: (v, o) => {
					Buffer.from(v.buffer, v.byteOffset + o, bytes.byteLength).set(bytes);
					return bytes.byteLength;
				},
			};
		}
	}
}

function lengthPrefix(len: number, version: number): Writable {
	if (version === 1) {
		return {
			byteLength: () => 4,
			write: (v, o) => {
				v.setUint32(o, len, true);
				return 4;
			},
		};
	}
	return {
		byteLength: () => 8,
		write: (v, o) => {
			v.setBigUint64(o, BigInt(len), true);
			return 8;
		},
	};
}

function typeIdWriter(id: number): Writable {
	return {
		byteLength: () => 4,
		write: (v, o) => {
			v.setUint32(o, id, true);
			return 4;
		},
	};
}

function stringWriter(s: string, version: number): Writable[] {
	const payload = scalarWriter("string", s);
	return [lengthPrefix(payload.byteLength(), version), payload];
}

function arrayWriter(
	itemType: ScalarTypeName,
	values: PrimitiveValue[],
	version: number,
): Writable[] {
	const elems = values.flatMap((v) =>
		itemType === "string"
			? stringWriter(String(v), version)
			: [scalarWriter(itemType, v)],
	);
	return [
		typeIdWriter(VALUE_TYPE_ID[itemType]),
		lengthPrefix(values.length, version),
		...elems,
	];
}

/**
 * Builds deterministic GGUF header binaries for tests/fixtures.
 * Supports v1 (u32 counts/lengths) and v2/v3 (u64 counts/lengths).
 */
export class GgufBuilder {
	private version = 3;
	private kvs: KvEntry[] = [];
	private tensors: { name: string; dims: bigint[]; ggmlType: number }[] = [];

	v(version: 1 | 2 | 3): this {
		this.version = version;
		return this;
	}

	kv(
		typeName: ScalarTypeName,
		key: string,
		value: PrimitiveValue | ArrayValue,
	): this {
		this.kvs.push({ key, typeName, value });
		return this;
	}

	kvArray(
		itemType: ScalarTypeName,
		key: string,
		values: PrimitiveValue[],
	): this {
		this.kvs.push({ key, typeName: "array", value: { itemType, values } });
		return this;
	}

	tensor(name: string, dims: number[], ggmlType = 0): this {
		this.tensors.push({ name, dims: dims.map((d) => BigInt(d)), ggmlType });
		return this;
	}

	build(): Uint8Array {
		const parts: Writable[][] = [];
		for (const { key, typeName, value } of this.kvs) {
			parts.push(stringWriter(key, this.version));
			parts.push([typeIdWriter(VALUE_TYPE_ID[typeName])]);
			if (typeName === "array") {
				const av = value as ArrayValue;
				parts.push(arrayWriter(av.itemType, av.values, this.version));
			} else if (typeName === "string") {
				parts.push(stringWriter(String(value), this.version));
			} else {
				parts.push([scalarWriter(typeName, value as PrimitiveValue)]);
			}
		}
		for (const t of this.tensors) {
			parts.push(stringWriter(t.name, this.version));
			parts.push([
				{
					byteLength: () => 4,
					write: (v, o) => {
						v.setUint32(o, t.dims.length, true);
						return 4;
					},
				},
			]);
			for (const d of t.dims) {
				parts.push([
					{
						byteLength: () => 8,
						write: (v, o) => {
							v.setBigUint64(o, d, true);
							return 8;
						},
					},
				]);
			}
			parts.push([typeIdWriter(t.ggmlType)]);
			parts.push([
				{
					byteLength: () => 8,
					write: (v, o) => {
						v.setBigUint64(o, 0n, true);
						return 8;
					},
				},
			]);
		}
		const headerLen = this.version === 1 ? 16 : 24;
		const bodyLen = parts.reduce(
			(a, ps) => a + ps.reduce((x, p) => x + p.byteLength(), 0),
			0,
		);
		const buf = new ArrayBuffer(headerLen + bodyLen);
		const view = new DataView(buf);
		view.setUint32(0, 0x46554747, true);
		view.setUint32(4, this.version, true);
		if (this.version === 1) {
			view.setUint32(8, this.tensors.length, true);
			view.setUint32(12, this.kvs.length, true);
		} else {
			view.setBigUint64(8, BigInt(this.tensors.length), true);
			view.setBigUint64(16, BigInt(this.kvs.length), true);
		}
		let off = headerLen;
		for (const ps of parts) {
			for (const p of ps) off += p.write(view, off);
		}
		return new Uint8Array(buf);
	}
}

/** Standard small-model metadata + tensor set used across scanner/UI tests. */
export function sampleLlamaQ4Km(name?: string): {
	buffer: Uint8Array;
	expectedParams: number;
} {
	void name;
	const b = new GgufBuilder();
	b.kv("string", "general.architecture", "llama")
		.kv("u32", "general.file_type", 15)
		.kv("u32", "llama.context_length", 2048)
		.kv("u32", "llama.block_count", 22)
		.kv("u32", "llama.embedding_length", 2048)
		.kv("u32", "llama.attention.head_count", 32)
		.kv("u32", "llama.attention.head_count_kv", 4)
		.kv("u32", "llama.vocab_size", 32000)
		.tensor("token_embd.weight", [2048, 32000])
		.tensor("blk.0.attn_q.weight", [2048, 2048]);
	const buffer = b.build();
	const params = 2048 * 32000 + 2048 * 2048;
	return { buffer, expectedParams: params };
}

export function writeFixture(
	dir: string,
	name: string,
	data: Uint8Array,
): string {
	mkdirSync(dirname(`${dir}/${name}`), { recursive: true });
	writeFileSync(`${dir}/${name}`, data);
	return `${dir}/${name}`;
}
