import { useTerminalDimensions } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import { formatBytes } from "../../core/estimate/vram";
import { shellQuote } from "../../core/export/quote";
import type { ModelEntry } from "../../core/models/types";
import { TuiBox } from "../components/box";
import { VirtualizedTable } from "../components/table";
import { TextInput } from "../components/text-input";
import { createTextInputState } from "../components/text-input-state";
import { useScopedKeyboard } from "../hooks/use-scoped-keyboard";
import {
	buildRows,
	defaultVramRange,
	inspectorFor,
} from "../logic/explorer-state";
import type { Theme } from "../themes";

export interface ExplorerProps {
	theme: Theme;
	entries: ModelEntry[];
	scanning?: boolean;
	modelsDir?: string | null;
	scanError?: string;
	focused?: boolean;
	captureKeys?: boolean;
	/** Controlled selection (optional); internal state when omitted. */
	selectedIndex?: number;
	onSelectIndex?: (index: number) => void;
	onSetModelsDir?: (dir: string) => void;
	onEditingChange?: (editing: boolean) => void;
}

/**
 * Viewport 1 — Model Explorer (§2.2, P3-FR-15..17): virtualized table
 * (60%), metadata inspector (40%), quick-launch preview strip.
 */
export function Explorer({
	theme,
	entries,
	scanning = false,
	modelsDir = null,
	scanError,
	focused = false,
	captureKeys = true,
	selectedIndex,
	onSelectIndex,
	onSetModelsDir,
	onEditingChange,
}: ExplorerProps) {
	const rows = buildRows(entries);
	const { height } = useTerminalDimensions();
	// The table lives above the fixed command-preview strip. Keep the table
	// virtualized, but derive its window from the terminal instead of imposing
	// an arbitrary twelve-row ceiling.
	const tableViewport = Math.max(1, height - 12);
	const [internalSelected, setSelected] = useState(0);
	const [editingDir, setEditingDir] = useState(false);
	const [dirInput, setDirInput] = useState(() => createTextInputState());

	// #42: notify at event time (not only from the effect) so the shell's
	// yield guard sees an open editor within the same key batch. The effect
	// still covers mount-consistency; both writes are idempotent.
	const editingChangeRef = useRef(onEditingChange);
	editingChangeRef.current = onEditingChange;
	const setEditing = (editing: boolean) => {
		setEditingDir(editing);
		editingChangeRef.current?.(editing);
	};
	useEffect(() => {
		editingChangeRef.current?.(editingDir);
	}, [editingDir]);

	useScopedKeyboard(captureKeys && !editingDir, (key) => {
		if (key.name === "m" && !key.ctrl && onSetModelsDir) {
			setDirInput(createTextInputState());
			setEditing(true);
			return;
		}
	});

	useScopedKeyboard(captureKeys && editingDir, (key) => {
		if (key.name === "return") {
			const trimmed = dirInput.buffer.trim();
			if (trimmed.length > 0) {
				onSetModelsDir?.(trimmed);
			}
			setEditing(false);
			return;
		}
		if (key.name === "escape") {
			setEditing(false);
			return;
		}
	});

	const select = (index: number) => {
		if (onSelectIndex) onSelectIndex(index);
		else setSelected(index);
	};
	const selected =
		selectedIndex !== undefined ? selectedIndex : internalSelected;
	const clamped = Math.min(selected, Math.max(rows.length - 1, 0));
	const current = rows[clamped]?.entry;

	const inspector = current ? inspectorFor(current) : null;
	const vram = current ? defaultVramRange(current) : null;

	return (
		<box
			style={{
				flexDirection: "column",
				width: "100%",
				height: "100%",
			}}
		>
			{editingDir ? (
				<TuiBox
					theme={theme}
					title="SET MODELS DIRECTORY"
					variant="double"
					accent
				>
					<box style={{ flexDirection: "column" }}>
						<text fg={theme.fgBright}>
							Enter model directory path (press Enter to confirm, Esc to
							cancel):
						</text>
						<TextInput
							theme={theme}
							captureKeys={captureKeys && editingDir}
							initial=""
							onChange={setDirInput}
							width={60}
							placeholder={modelsDir ?? "path/to/models"}
						/>
					</box>
				</TuiBox>
			) : modelsDir === null && !scanning ? (
				<TuiBox theme={theme} title="WELCOME" variant="double" accent>
					<box style={{ flexDirection: "column" }}>
						<text fg={theme.fgBright}>No model directory configured yet.</text>
						<text fg={theme.muted}>
							Set one to begin scanning for .gguf files:
						</text>
						<text fg={theme.accent}>{"  [m] set models directory"}</text>
						<text fg={theme.muted}>{"  run: llama-deck scan <dir>"}</text>
					</box>
				</TuiBox>
			) : (
				<box style={{ flexDirection: "row", flexGrow: 1 }}>
					<TuiBox
						theme={theme}
						title={`MODELS${modelsDir ? ` (${modelsDir})` : ""}`}
						width="60%"
						flexGrow={1}
						focused={focused}
					>
						<box style={{ flexDirection: "column", flexGrow: 1 }}>
							<VirtualizedTable
								theme={theme}
								columns={[
									{
										key: "displayName",
										title: "NAME",
										width: 30,
										align: "left",
									},
									{
										key: "sizeLabel",
										title: "SIZE",
										width: 8,
										align: "right",
									},
									{
										key: "quantLabel",
										title: "QUANT",
										width: 7,
										align: "left",
									},
									{
										key: "archLabel",
										title: "ARCH",
										width: 10,
										align: "left",
									},
								]}
								data={rows}
								viewport={tableViewport}
								captureKeys={captureKeys}
								focused={focused}
								onSelectionChange={(index) => select(index)}
							/>
							{scanning ? <text fg={theme.accent}> scanning...</text> : null}
							{scanError ? (
								<text fg={theme.error}> scan failed: {scanError}</text>
							) : null}
							{!scanning && rows.length === 0 && !scanError ? (
								<text fg={theme.warn}>
									{
										" no .gguf files found — add models, [r] rescan · [m] change dir"
									}
								</text>
							) : null}
						</box>
					</TuiBox>

					<TuiBox
						theme={theme}
						title="METADATA INSPECTOR"
						width="40%"
						flexGrow={1}
					>
						<box style={{ flexDirection: "column" }}>
							{inspector ? (
								inspector.lines.map((line) => (
									<text
										key={line.label}
										fg={line.warn ? theme.warn : theme.fgBright}
									>
										<span fg={line.warn ? theme.warn : theme.muted}>
											{`${line.label}: `}
										</span>
										<span fg={line.warn ? theme.warn : theme.fgBright}>
											{line.value}
										</span>
									</text>
								))
							) : (
								<text fg={theme.muted}>no model selected</text>
							)}
							{vram && !current?.error ? (
								<box style={{ flexDirection: "column" }}>
									<text>
										<span fg={theme.muted}>{"Est. VRAM: "}</span>
										<span fg={theme.success}>
											{`${formatBytes(vram.low)}-${formatBytes(vram.high)}`}
										</span>
									</text>
									<text fg={theme.muted}>(estimated range)</text>
								</box>
							) : null}
						</box>
					</TuiBox>
				</box>
			)}

			<TuiBox
				theme={theme}
				title="QUICK LAUNCH COMMAND PREVIEW"
			>
				{current?.incomplete ? (
					<text fg={theme.warn}>
						{`incomplete split group — add the missing parts and rescan [r]`}
					</text>
				) : (
					<text fg={current && !current.error ? theme.fg : theme.muted}>
						{current && !current.error
							? `llama-server -m ${shellQuote(current.path)}`
							: "select a model to preview its command"}
					</text>
				)}
			</TuiBox>
		</box>
	);
}
