import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import type { Preset, PresetFile } from "../../core/store/presets";
import { TuiBox } from "../components/box";
import { VirtualizedTable } from "../components/table";
import { buildRows, type PresetRow } from "../logic/presets-state";
import type { Theme } from "../themes";

export interface PresetsScreenProps {
	theme: Theme;
	file: PresetFile;
	existingModelPaths: Set<string>;
	onClone?: (id: string) => void;
	onDelete?: (id: string) => void;
	onSetDefault?: (id: string) => void;
	onLoad?: (preset: Preset) => void;
	onRelink?: (id: string, newPath: string) => void;
	focused?: boolean;
	captureKeys?: boolean;
}

/**
 * Viewport 4 — Presets (§2, P4-FR-19): list, clone (c), delete (d),
 * set-default (Enter), load into configurator (l), re-link broken (r).
 */
export function PresetsScreen({
	theme,
	file,
	existingModelPaths,
	onClone,
	onDelete,
	onSetDefault,
	onLoad,
	focused = false,
	captureKeys = true,
}: PresetsScreenProps) {
	const [selected, setSelected] = useState(0);
	const rows: PresetRow[] = buildRows(file.presets, existingModelPaths);
	const clamped = Math.min(selected, Math.max(rows.length - 1, 0));
	const currentRow = rows[clamped];
	const currentPreset = file.presets.find((p) => p.id === currentRow?.id);
	const isDefault = file.lastSession?.preset_id === currentRow?.id;

	useKeyboard((key) => {
		if (!captureKeys) return;
		const id = currentPreset?.id;
		if (!id) return;
		if (key.name === "c") onClone?.(id);
		else if (key.name === "d") onDelete?.(id);
		else if (key.name === "return") onSetDefault?.(id);
		else if (key.name === "l" && currentPreset) onLoad?.(currentPreset);
	});

	return (
		<box style={{ flexDirection: "column", width: "100%", height: "100%" }}>
			<TuiBox theme={theme} title="PRESETS" flexGrow={1} focused={focused}>
				<VirtualizedTable
					theme={theme}
					columns={[
						{ key: "name", title: "NAME", width: 34, align: "left" },
						{ key: "modelPath", title: "MODEL", width: 40, align: "left" },
						{ key: "statusLabel", title: "STATUS", width: 10, align: "left" },
						{
							key: "lastUsedLabel",
							title: "LAST USED",
							width: 20,
							align: "left",
						},
					]}
					data={rows.map((r) => ({
						id: r.id,
						name: `${file.lastSession?.preset_id === r.id ? "* " : ""}${r.name}`,
						modelPath: r.modelPath,
						statusLabel: r.status === "ok" ? "ok" : "BROKEN",
						lastUsedLabel:
							r.lastUsed === null
								? "never"
								: r.lastUsed.slice(0, 16).replace("T", " "),
					}))}
					viewport={12}
					captureKeys={captureKeys}
					focused={focused}
					onSelectionChange={setSelected}
				/>
			</TuiBox>
			<TuiBox theme={theme} title="ACTIONS" height={5}>
				<box style={{ flexDirection: "column", paddingLeft: 1 }}>
					<text fg={theme.muted}>
						{
							" [c] Clone   [d] Delete   [Enter] Set Default   [l] Load into Configurator"
						}
					</text>
					{text(
						currentRow?.status === "broken"
							? " preset is BROKEN — model file missing; re-scan or re-link via Explorer + re-save"
							: currentRow?.unknownFlags.length
								? ` unknown flags kept verbatim: ${currentRow.unknownFlags.join(", ")}`
								: "",
						theme.warn,
					)}
					<text fg={isDefault ? theme.accent : theme.muted}>
						{isDefault ? " * default preset (restored on boot)" : ""}
					</text>
				</box>
			</TuiBox>
		</box>
	);
}

function text(content: string, color: string | undefined) {
	return <text fg={color}>{content}</text>;
}
