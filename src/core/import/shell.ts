/**
 * Strict POSIX shell command tokenizer & importer (§3.3, Idea B / #5).
 *
 * Pure, headless, core-only (D5-safe).
 * Never executes a subshell or eval. Inverse function of `shellQuote()` + exporter.
 */
import { type FlagEntry, REGISTRY } from "../flags/registry";

export class ShellImportError extends Error {
	constructor(message: string) {
		super(`Shell import error: ${message}`);
		this.name = "ShellImportError";
	}
}

export interface TokenizedScript {
	argv: string[];
	envVars: Record<string, string>;
}

export interface ParsedShellCommand {
	modelPath: string;
	values: Record<string, unknown>;
	envVars: Record<string, string>;
	unknownFlags: string[];
}

/**
 * Tokenize a strict subset of POSIX shell:
 * - Bare words and single-quoted strings (including `'\''` single-quote escapes)
 * - Comment lines starting with `#`
 * - Trailing `\` line continuations
 * - Optional leading `$` prompt marker
 * - `export KEY=VALUE` statements
 * - Optional `exec` prefix before command
 *
 * Hard-rejects any ambiguous or executable shell syntax:
 * - Double quotes (`"`)
 * - Variable expansions (`$var`, `${var}`)
 * - Control operators (`&&`, `||`, `;`, `&`, `|`, `>`, `<`, `(`, `)`)
 * - Backticks (`` ` ``)
 */
export function tokenizeShellScript(input: string): TokenizedScript {
	const envVars: Record<string, string> = {};
	const lines = input.split("\n");

	let combinedCommand = "";

	for (let line of lines) {
		line = line.trim();
		if (!line || line.startsWith("#")) continue;

		// Strip leading $ prompt marker if present
		if (line.startsWith("$ ")) {
			line = line.slice(2).trim();
		} else if (line === "$") {
			continue;
		}

		if (line.startsWith("export ")) {
			const assign = line.slice(7).trim();
			const eqIdx = assign.indexOf("=");
			if (eqIdx === -1) {
				throw new ShellImportError(`Invalid export line: ${line}`);
			}
			const key = assign.slice(0, eqIdx).trim();
			const valRaw = assign.slice(eqIdx + 1).trim();
			const tokens = tokenizeWords(valRaw);
			if (tokens.length !== 1) {
				throw new ShellImportError(
					`Expected single value in export for ${key}`,
				);
			}
			envVars[key] = tokens[0] ?? "";
			continue;
		}

		if (line.endsWith("\\")) {
			combinedCommand += ` ${line.slice(0, -1).trim()}`;
		} else {
			combinedCommand += ` ${line}`;
		}
	}

	const rawWords = tokenizeWords(combinedCommand.trim());

	// Filter out optional leading 'exec'
	const argv = rawWords[0] === "exec" ? rawWords.slice(1) : rawWords;

	return { argv, envVars };
}

function tokenizeWords(str: string): string[] {
	const words: string[] = [];
	let i = 0;

	while (i < str.length) {
		// Skip whitespace
		while (i < str.length && /\s/.test(str[i] ?? "")) {
			i++;
		}
		if (i >= str.length) break;

		let currentWord = "";

		while (i < str.length && !/\s/.test(str[i] ?? "")) {
			const ch = str[i] ?? "";

			// Hard-rejected characters
			if (ch === '"') {
				throw new ShellImportError(
					'Double quotes (") are not permitted in strict shell import',
				);
			}
			if (ch === "`") {
				throw new ShellImportError("Backticks (`) are not permitted");
			}
			if (
				ch === "$" &&
				i + 1 < str.length &&
				/[a-zA-Z_{]/.test(str[i + 1] ?? "")
			) {
				throw new ShellImportError(
					`Variable expansion ($${str[i + 1]}) is not permitted`,
				);
			}
			if (
				ch === ";" ||
				ch === "&" ||
				ch === "|" ||
				ch === ">" ||
				ch === "<" ||
				ch === "(" ||
				ch === ")"
			) {
				throw new ShellImportError(
					`Shell control operator (${ch}) is not permitted`,
				);
			}

			if (ch === "'") {
				// Single-quoted block
				i++; // Skip opening '
				while (i < str.length) {
					if (str[i] === "'") {
						// Check for '\'' escape pattern
						if (str.slice(i, i + 4) === "'\\''") {
							currentWord += "'";
							i += 4;
							continue;
						}
						// Closing single-quote
						i++;
						break;
					}
					currentWord += str[i];
					i++;
				}
			} else if (ch === "\\") {
				// Escaped character outside quotes
				i++;
				if (i < str.length) {
					currentWord += str[i];
					i++;
				}
			} else {
				currentWord += ch;
				i++;
			}
		}

		if (currentWord.length > 0) {
			words.push(currentWord);
		}
	}

	return words;
}

/** CLI flag mapping to FlagId in registry */
const CLI_TO_REGISTRY: Record<string, FlagEntry> = {};
for (const entry of Object.values(REGISTRY)) {
	for (const cli of entry.cli) {
		CLI_TO_REGISTRY[cli] = entry;
	}
}

/**
 * Parse a shell command / export script into modelPath, registry values, and envVars.
 */
export function parseShellCommand(input: string): ParsedShellCommand {
	const { argv, envVars } = tokenizeShellScript(input);

	if (argv.length === 0) {
		throw new ShellImportError("No command found in input");
	}

	// First word is executable name, e.g. llama-server or ./llama-server
	const args = argv.slice(1);
	let modelPath = "";
	const values: Record<string, unknown> = {};
	const unknownFlags: string[] = [];

	let i = 0;
	while (i < args.length) {
		const arg = args[i] ?? "";

		if (arg === "-m" || arg === "--model") {
			i++;
			if (i >= args.length) {
				throw new ShellImportError("Missing argument for model flag");
			}
			modelPath = args[i] ?? "";
			i++;
			continue;
		}

		const entry = CLI_TO_REGISTRY[arg];
		if (!entry) {
			if (arg.startsWith("-")) {
				unknownFlags.push(arg);
			}
			i++;
			continue;
		}

		if (entry.type === "bool") {
			// slots and metrics are auto-injected by the builder in the tail;
			// only record if explicitly negated, otherwise let builder telemetry handle them
			if (entry.id !== "slots" && entry.id !== "metrics") {
				values[entry.id] = true;
			}
			i++;
			continue;
		}

		i++;
		if (i >= args.length) {
			throw new ShellImportError(`Missing value for flag ${arg}`);
		}
		const valStr = args[i] ?? "";

		if (entry.type === "int") {
			const n = Number.parseInt(valStr, 10);
			if (Number.isNaN(n)) {
				throw new ShellImportError(
					`Invalid integer value '${valStr}' for flag ${arg}`,
				);
			}
			values[entry.id] = n;
		} else {
			values[entry.id] = valStr;
		}

		i++;
	}

	return {
		modelPath,
		values,
		envVars,
		unknownFlags,
	};
}
