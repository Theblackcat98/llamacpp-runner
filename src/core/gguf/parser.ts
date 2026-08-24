import { NeedMoreBytes, ParseError } from "./errors";
import { quantName } from "./quant-map";
import type {
	GgufHeader,
	MetadataArray,
	MetadataValue,
	ModelInfo,
	ScalarTypeName,
	TensorInfo,
} from "./types";

const MAGIC = 0x46554747;
export const INITIAL_CAP = 256 * 1024;
export const RETRY_CAP = 2 * 1024 * 1024;
/**
 * Safety valve below HEADER_TOO_LARGE. Real captured headers: qwen2.5-7b
 * 5.95 MB, gemma3-4b 6.54 MB, deepseek2-lite 4.00 MB — vocab string arrays
 * push modern headers far past the 2 MB retry (P3-FR-07 risk row).
 */
export const FINAL_CAP = 32 * 1024 * 1024;
const MAX_SAFE_PARAMS = Number.MAX_SAFE_INTEGER;

const TYPE_NAMES: Record<number, ScalarTypeName> = {
	0: "u8",
	1: "i8",
	2: "u16",
	3: "i16",
	4: "u32",
	5: "i32",
	6: "f32",
	7: "bool",
	8: "string",
	10: "u64",
	11: "i64",
	12: "f64",
};

class Reader {
	private view: DataView;
	offset = 0;

	constructor(private bytes: Uint8Array) {
		this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	}

	get remaining(): number {
		return this.bytes.byteLength - this.offset;
	}

	private need(n: number): void {
		if (this.remaining < n) throw new NeedMoreBytes();
	}

	u8(): number {
		this.need(1);
		const v = this.view.getUint8(this.offset);
		this.offset += 1;
		return v;
	}

	i16(): number {
		this.need(2);
		const v = this.view.getInt16(this.offset, true);
		this.offset += 2;
		return v;
	}

	u16(): number {
		this.need(2);
		const v = this.view.getUint16(this.offset, true);
		this.offset += 2;
		return v;
	}

	i32(): number {
		this.need(4);
		const v = this.view.getInt32(this.offset, true);
		this.offset += 4;
		return v;
	}

	u32(): number {
		this.need(4);
		const v = this.view.getUint32(this.offset, true);
		this.offset += 4;
		return v;
	}

	f32(): number {
		this.need(4);
		const v = this.view.getFloat32(this.offset, true);
		this.offset += 4;
		return v;
	}

	f64(): number {
		this.need(8);
		const v = this.view.getFloat64(this.offset, true);
		this.offset += 8;
		return v;
	}

	i64(): bigint {
		this.need(8);
		const v = this.view.getBigInt64(this.offset, true);
		this.offset += 8;
		return v;
	}

	u64(): bigint {
		this.need(8);
		const v = this.view.getBigUint64(this.offset, true);
		this.offset += 8;
		return v;
	}

	string(version: number): string {
		let len: number;
		if (version === 1) len = this.u32();
		else len = Number(this.u64());
		this.need(len);
		const slice = this.bytes.subarray(this.offset, this.offset + len);
		this.offset += len;
		return new TextDecoder().decode(slice);
	}
}

function readValue(r: Reader, version: number): MetadataValue {
	const typeId = r.u32();
	if (typeId === 9) {
		const elemTypeId = r.u32();
		const itemType = TYPE_NAMES[elemTypeId];
		if (!itemType)
			throw new ParseError(
				"TRUNCATED",
				`unknown array element type ${elemTypeId}`,
			);
		const count = version === 1 ? r.u32() : Number(r.u64());
		const values: (number | bigint | string | boolean)[] = [];
		for (let i = 0; i < count; i++) {
			values.push(readValueOf(r, version, itemType));
		}
		const arr: MetadataArray = { kind: "array", itemType, values };
		return arr;
	}
	const typeName = TYPE_NAMES[typeId];
	if (!typeName)
		throw new ParseError("TRUNCATED", `unknown value type ${typeId}`);
	return readValueOf(r, version, typeName);
}

function readValueOf(
	r: Reader,
	version: number,
	typeName: ScalarTypeName,
): number | bigint | string | boolean {
	switch (typeName) {
		case "u8":
			return r.u8();
		case "i8": {
			const b = r.u8();
			return b > 0x7f ? b - 0x100 : b;
		}
		case "u16":
			return r.u16();
		case "i16":
			return r.i16();
		case "u32":
			return r.u32();
		case "i32":
			return r.i32();
		case "f32":
			return r.f32();
		case "bool":
			return r.u8() !== 0;
		case "string":
			return r.string(version);
		case "u64":
			return r.u64();
		case "i64":
			return r.i64();
		case "f64":
			return r.f64();
	}
}

/** Parses a complete in-memory header. Throws typed ParseErrors, never crashes. */
export function parseGgufBytes(bytes: Uint8Array): GgufHeader {
	try {
		return parseInner(bytes).header;
	} catch (e) {
		if (e instanceof NeedMoreBytes) throw new ParseError("TRUNCATED");
		throw e;
	}
}

/**
 * Byte offset just past the header (KV + tensor info table). Used by fixture
 * capture to store exactly the header bytes of real files.
 */
export function headerEndOffset(bytes: Uint8Array): number {
	return parseInner(bytes).endOffset;
}

function parseInner(bytes: Uint8Array): {
	header: GgufHeader;
	endOffset: number;
} {
	const r = new Reader(bytes);
	if (bytes.byteLength < 4 || r.u32() !== MAGIC)
		throw new ParseError("BAD_MAGIC");
	if (r.remaining < 4) throw new NeedMoreBytes();
	const rawVersion = r.u32();
	if (rawVersion !== 1 && rawVersion !== 2 && rawVersion !== 3) {
		throw new ParseError("UNSUPPORTED_VERSION", `gguf v${rawVersion}`);
	}
	const version = rawVersion as 1 | 2 | 3;
	const tensorCount = version === 1 ? r.u32() : Number(r.u64());
	const kvCount = version === 1 ? r.u32() : Number(r.u64());

	const kv = new Map<string, MetadataValue>();
	for (let i = 0; i < kvCount; i++) {
		const key = r.string(version);
		kv.set(key, readValue(r, version));
	}

	const tensors: TensorInfo[] = [];
	for (let i = 0; i < tensorCount; i++) {
		const name = r.string(version);
		const nDims = r.u32();
		const dims: bigint[] = [];
		for (let d = 0; d < nDims; d++) dims.push(r.u64());
		const ggmlType = r.u32();
		const offset = r.u64();
		tensors.push({ name, dims, ggmlType, offset });
	}

	let totalParams = 0n;
	for (const t of tensors) {
		let prod = 1n;
		for (const d of t.dims) prod *= d;
		totalParams += prod;
	}
	if (totalParams > BigInt(MAX_SAFE_PARAMS)) {
		throw new ParseError(
			"HEADER_TOO_LARGE",
			"parameter count exceeds safe integer range",
		);
	}

	return {
		header: { version, kv, tensors, totalParams: Number(totalParams) },
		endOffset: r.offset,
	};
}

/**
 * P3-FR-07 streaming cap: read min(fileSize, 256KB); one retry at 2MB; a
 * final 32MB safety valve covers huge-vocab headers before HEADER_TOO_LARGE.
 */
export async function parseGgufFile(path: string): Promise<GgufHeader> {
	const file = Bun.file(path);
	const caps = [INITIAL_CAP, RETRY_CAP, FINAL_CAP];
	for (const cap of caps) {
		const readLen = Math.min(file.size, cap);
		const bytes = new Uint8Array(await file.slice(0, readLen).arrayBuffer());
		try {
			return parseGgufBytes(bytes);
		} catch (e) {
			const exhausted = e instanceof NeedMoreBytes;
			const truncated = e instanceof ParseError && e.code === "TRUNCATED";
			if (!(exhausted || truncated)) throw e;
			if (readLen >= file.size) {
				throw new ParseError("TRUNCATED", `${path} ends inside its header`);
			}
			if (cap === FINAL_CAP) {
				throw new ParseError(
					"HEADER_TOO_LARGE",
					`${path}: header spans beyond ${FINAL_CAP} bytes`,
				);
			}
		}
	}
	throw new ParseError("HEADER_TOO_LARGE", path);
}

const num = (v: MetadataValue | undefined): number | undefined =>
	typeof v === "number" ? v : undefined;

export function extractModelInfo(header: GgufHeader): ModelInfo {
	const arch =
		typeof header.kv.get("general.architecture") === "string"
			? (header.kv.get("general.architecture") as string)
			: undefined;
	const fileTypeCode = num(header.kv.get("general.file_type"));
	const a = (suffix: string): MetadataValue | undefined =>
		arch ? header.kv.get(`${arch}.${suffix}`) : undefined;
	return {
		architecture: arch,
		quantName: quantName(fileTypeCode),
		fileTypeCode,
		contextLength: num(a("context_length")),
		blockCount: num(a("block_count")),
		embeddingLength: num(a("embedding_length")),
		headCount: num(a("attention.head_count")),
		headCountKv: num(a("attention.head_count_kv")),
		keyLength: num(a("attention.key_length")),
		vocabSize: num(a("vocab_size")),
		totalParams: header.totalParams,
	};
}

export function computeEffectiveBpw(
	totalParams: number,
	fileSize: number,
): number {
	return (fileSize * 8) / totalParams;
}
