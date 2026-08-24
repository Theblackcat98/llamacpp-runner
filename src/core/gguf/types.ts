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

export interface MetadataArray {
	kind: "array";
	itemType: ScalarTypeName;
	values: (number | bigint | string | boolean)[];
}

export type MetadataValue = number | bigint | string | boolean | MetadataArray;

export interface TensorInfo {
	name: string;
	dims: bigint[];
	ggmlType: number;
	offset: bigint;
}

export interface GgufHeader {
	version: 1 | 2 | 3;
	kv: Map<string, MetadataValue>;
	tensors: TensorInfo[];
	totalParams: number;
}

export interface ModelInfo {
	architecture?: string;
	quantName: string;
	fileTypeCode?: number;
	contextLength?: number;
	blockCount?: number;
	embeddingLength?: number;
	headCount?: number;
	headCountKv?: number;
	keyLength?: number;
	vocabSize?: number;
	totalParams: number;
}
