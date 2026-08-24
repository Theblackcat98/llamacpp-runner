/// <reference lib="webworker" />
import { extractModelInfo, parseGgufFile } from "../gguf/parser";
import type { ModelInfo } from "../gguf/types";

export interface ParseRequest {
	id: number;
	path: string;
}

export interface ParseResponse {
	id: number;
	ok: boolean;
	info?: ModelInfo;
	error?: string;
}

self.onmessage = async (event: MessageEvent<ParseRequest>) => {
	const { id, path } = event.data;
	try {
		const header = await parseGgufFile(path);
		self.postMessage({ id, ok: true, info: extractModelInfo(header) });
	} catch (err) {
		self.postMessage({
			id,
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		});
	}
};
