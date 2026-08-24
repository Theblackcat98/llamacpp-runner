/**
 * Runtime --help validation (§3.3, P4-FR-04, P4-NFR-03): parses
 * `llama-server --help` output into a token index. Tolerant to format drift —
 * unknown lines are ignored, never fatal.
 */

export interface HelpIndex {
	/** All recognized CLI tokens (short and long forms). */
	tokens: Set<string>;
	/** Tokens whose definition line carries a DEPRECATED marker. */
	deprecated: Set<string>;
	has(token: string): boolean;
	isDeprecated(token: string): boolean;
	size(): number;
}

/**
 * A flag-definition line starts with '-' at column 0, e.g.
 *   -fa,   --flash-attn [on|off|auto]    set Flash Attention use ...
 * Continuation lines are indented and ignored. Tokens like `--foo-bar`,
 * `-ngl` are collected; trailing arg placeholders (N, TYPE) are not flags.
 */
import { REGISTRY } from "./registry";

const FLAG_LINE = /^-{1,2}[A-Za-z]/;

const TOKEN = /(?<![\w-])(--?[A-Za-z][A-Za-z0-9-]*)(?![\w-])/g;

export function parseHelp(text: string): HelpIndex {
	const tokens = new Set<string>();
	const deprecated = new Set<string>();

	for (const line of text.split("\n")) {
		if (!FLAG_LINE.test(line)) continue;
		const isDeprecated = /DEPRECATED/i.test(line);
		for (const match of line.matchAll(TOKEN)) {
			// Strip trailing punctuation artifacts from wrapped definitions.
			const token = (match[1] as string).replace(/[-]+$/, "");
			if (token.length < 2) continue;
			// Single-char long tokens ("-" alone) and bare dashes are not flags.
			if (!token.startsWith("-")) continue;
			tokens.add(token);
			if (isDeprecated) deprecated.add(token);
		}
	}

	return {
		tokens,
		deprecated,
		has(token: string): boolean {
			return tokens.has(token);
		},
		isDeprecated(token: string): boolean {
			return deprecated.has(token);
		},
		size(): number {
			return tokens.size;
		},
	};
}

export interface FlagAvailability {
	supported: boolean;
	deprecated: boolean;
}

/**
 * Map every registry flag to { supported, deprecated } against a captured
 * help text (P4-FR-04). A flag is supported when ANY of its cli aliases
 * appears in the binary's help output.
 */
export function registryAvailability(
	helpText: string,
): Record<string, FlagAvailability> {
	const index = parseHelp(helpText);
	const result: Record<string, FlagAvailability> = {};
	for (const [id, entry] of Object.entries(REGISTRY)) {
		let supported = false;
		let deprecated = false;
		for (const cli of entry.cli) {
			if (index.has(cli)) {
				supported = true;
				if (index.isDeprecated(cli)) deprecated = true;
			}
		}
		result[id] = { supported, deprecated };
	}
	return result;
}
