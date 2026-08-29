/**
 * Format-aware quoting (§3.3, Phase 12): one place that knows how to build a
 * command line for every target format so previews, exports, and the spawned
 * argv can never drift apart. Pure functions — deterministic golden-tested.
 *
 * Formats:
 *  - shell (POSIX sh, also what `.sh` export and `cmd` preview use)
 *  - systemd (ExecStart / Environment quoting rules)
 */

/** Chars that never need quoting/escaping in a shell word. */
const SAFE_SHELL = /^[A-Za-z0-9_\-./:=@%^+]+$/;

/** Chars safe in a systemd ExecStart token (systemd's safe set is smaller). */
const SAFE_SYSTEMD = /^[A-Za-z0-9_.\-/:=@+]+$/;

/**
 * POSIX shell single-quote: wrapping in single quotes with the `'\''`
 * splice gives a byte-exact argument to sh. Used for preview, `cmd` export,
 * and `.sh` export.
 */
export function shellQuote(word: string): string {
	if (SAFE_SHELL.test(word)) return word;
	return `'${word.replaceAll("'", `'\\''`)}'`;
}

/**
 * systemd value quoting. systemd does not do word-splitting on spaces inside
 * double quotes, so a space needs no escaped form — only `\`, `"`, and `%`
 * (a specifier prefix) must be escaped. Tokens made only of the conservative
 * safe set are left bare.
 */
export function systemdQuote(word: string): string {
	if (SAFE_SYSTEMD.test(word)) return word;
	const escaped = word
		.replaceAll("\\", "\\\\")
		.replaceAll('"', '\\"')
		.replaceAll("%", "%%");
	return `"${escaped}"`;
}

/** systemd only: quote an entire `KEY=value` assignment token. */
export function systemdEnvironment(key: string, value: string): string {
	return `Environment="${key}=${value.replaceAll(/\\|"|%/g, (m: string) =>
		m === "%" ? "%%" : `\\${m}`,
	)}"`;
}
/**
 * Build a single command line for a target format from argv.
 * `cmd`/`shell` share POSIX quoting so the preview matches what sh would exec.
 */
export type CommandFormat = "shell" | "systemd";

export function formatCommand(
	command: string,
	args: string[],
	format: CommandFormat,
): string {
	const quote = format === "systemd" ? systemdQuote : shellQuote;
	return [quote(command), ...args.map(quote)].join(" ");
}

/** Quote a value on the right side of `VAR=` for a given format. */
export function formatEnvValue(value: string, format: CommandFormat): string {
	return format === "systemd" ? systemdQuote(value) : shellQuote(value);
}
