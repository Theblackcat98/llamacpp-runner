/**
 * systemd exporter (§3.3, P4-FR-16c): user unit with Type=simple,
 * Restart=on-failure and a fully quoted ExecStart.
 */
import type { BuiltCommand } from "../flags/builder";

export interface SystemdUnitInput {
	built: BuiltCommand;
	envVars: Record<string, string>;
	description: string;
}

export function buildSystemdUnit(input: SystemdUnitInput): string {
	const lines: string[] = [
		"[Unit]",
		`Description=${input.description}`,
		"",
		"[Service]",
		"Type=simple",
		"Restart=on-failure",
	];
	for (const [key, value] of Object.entries(input.envVars)) {
		lines.push(`Environment="${key}=${value}"`);
	}
	lines.push(`ExecStart=${execLine(input.built)}`);
	lines.push("", "[Install]", "WantedBy=default.target");
	return `${lines.join("\n")}\n`;
}

/** systemd ExecStart value: quote args containing non-safe characters. */
function execLine(built: BuiltCommand): string {
	const parts = [
		built.command,
		...built.args.map((a) =>
			/^[A-Za-z0-9_\-./:=@%^+]+$/.test(a) ? a : `"${a.replaceAll('"', '\\"')}"`,
		),
	];
	return parts.join(" ");
}
