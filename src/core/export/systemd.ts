/**
 * systemd exporter (§3.3, P4-FR-16c): user unit with Type=simple,
 * Restart=on-failure and a fully quoted ExecStart.
 */

import type { BuiltCommand } from "../flags/builder";
import {
	formatCommand,
	isValidEnvKey,
	sanitizeTextLine,
	systemdEnvironment,
} from "./quote";

export interface SystemdUnitInput {
	built: BuiltCommand;
	envVars: Record<string, string>;
	description: string;
}

export function buildSystemdUnit(input: SystemdUnitInput): string {
	const lines: string[] = [
		"[Unit]",
		// #62: the description is untrusted — one line, no controls.
		`Description=${sanitizeTextLine(input.description)}`,
		"",
		"[Service]",
		"Type=simple",
		"Restart=on-failure",
	];
	for (const [key, value] of Object.entries(input.envVars)) {
		// #62: invalid identifiers cannot be exported safely — skipped.
		if (!isValidEnvKey(key)) continue;
		lines.push(systemdEnvironment(key, value));
	}
	lines.push(
		`ExecStart=${formatCommand(input.built.command, input.built.args, "systemd")}`,
	);
	lines.push("", "[Install]", "WantedBy=default.target");
	return `${lines.join("\n")}\n`;
}
