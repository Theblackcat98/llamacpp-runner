/**
 * Preset -> launch plan / export text (§1.1 CLI frontend; §9 Phase 4):
 * `llama-deck start <preset>` and `llama-deck export <preset>` reuse the
 * same registry-driven builder and exporters as the TUI.
 */

import { buildShellScript } from "./export/sh";
import { buildSystemdUnit } from "./export/systemd";
import { buildCommand, commandLine } from "./flags/builder";
import type { LaunchPlan } from "./session";
import type { Preset } from "./store/presets";

export function presetToPlan(preset: Preset): LaunchPlan {
	const port =
		typeof preset.flags.port === "number"
			? (preset.flags.port as number)
			: 8080;
	const built = buildCommand({
		modelPath: preset.model_path,
		values: preset.flags,
	});
	return {
		command: built.command,
		args: built.args,
		port,
		presetId: preset.id,
		host:
			typeof preset.flags.host === "string"
				? (preset.flags.host as string)
				: "127.0.0.1",
		env: preset.env_vars,
	};
}

export type ExportFormat = "cmd" | "sh" | "systemd";

export function exportPreset(preset: Preset, format: ExportFormat): string {
	const plan = presetToPlan(preset);
	const built = { command: plan.command, args: plan.args };
	switch (format) {
		case "cmd":
			return commandLine(built);
		case "sh":
			return buildShellScript({
				built,
				envVars: preset.env_vars,
				presetName: preset.name,
			});
		case "systemd":
			return buildSystemdUnit({
				built,
				envVars: preset.env_vars,
				description: `llama-deck: ${preset.name}`,
			});
	}
}
