import { useTerminalDimensions } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import { formatBytes } from "../../core/estimate/vram";
import { shellQuote } from "../../core/export/quote";
import type { ModelEntry } from "../../core/models/types";
import { TuiBox } from "../components/box";
import { VirtualizedTable } from "../components/table";
import { truncateMiddle } from "../components/table-state";
import { TextInput } from "../components/text-input";
import { createTextInputState } from "../components/text-input-state";
import { type IconSet, iconFor } from "../glyphs";
import { useScopedKeyboard } from "../hooks/use-scoped-keyboard";
import {
	applyFilterKey,
	buildRows,
	cycleSortMode,
	defaultVramRange,
	type ExplorerSortMode,
	inspectorFor,
	sortModeLabel,
	viewEntries,
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
	/** Increment to request the directory editor from outside (palette). */
	dirEditSignal?: number;
	/** Extra table rows available (e.g. console drawer collapsed). */
	extraRows?: number;
	/** Host validation for a candidate directory; an error string blocks
	 * the submit BEFORE anything is persisted (Tier 2). */
	validateDir?: (dir: string) => string | null;
	/** Nerd Font icons when "nerd", ASCII glyphs otherwise. */
	iconSet?: IconSet;
	/** Double-click on a row (Tier 3 mouse): the Enter equivalent — the
	 * shell navigates to Launch Config. */
	onActivate?: () => void;
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
	onActivate,
	dirEditSignal = 0,
	extraRows = 0,
	validateDir,
	iconSet = "ascii",
}: ExplorerProps) {
	const welcomeIcon = iconFor("empty-welcome", iconSet);
	const emptyIcon = iconFor("empty-none", iconSet);
	const withIcon = (icon: string, text: string) =>
		icon ? `${icon} ${text}` : text;
	const { height } = useTerminalDimensions();
	// The table lives above the fixed command-preview strip. Keep the table
	// virtualized, but derive its window from the terminal instead of imposing
	// an arbitrary twelve-row ceiling.
	// Drawer-aware: a collapsed console returns its rows to the table.
	const tableViewport = Math.max(1, height - 12 + extraRows);
	const [internalSelected, setSelected] = useState(0);
	// Tier 3: filter + sort view state. The selection tracks the model's
	// PATH (identity), never a row index, so filtering/sorting moves the
	// cursor with its model instead of landing on whatever row inherited
	// the old index.
	const [filterQuery, setFilterQuery] = useState("");
	const [filtering, setFiltering] = useState(false);
	const [sortMode, setSortMode] = useState<ExplorerSortMode>("scan");
	const [cursorPath, setCursorPath] = useState<string | null>(null);
	const cursorPathRef = useRef<string | null>(null);
	const setCursor = (path: string | null) => {
		cursorPathRef.current = path;
		setCursorPath(path);
	};
	const filteringRef = useRef(false);
	// The `/` that opens the filter is dispatched to BOTH scoped handlers
	// (registration order): the filter handler must not type it.
	const filterOpenerRef = useRef(false);
	const filterQueryRef = useRef("");
	const sortModeRef = useRef<ExplorerSortMode>("scan");
	const fullSelectedRef = useRef(0);
	const [editingDir, setEditingDir] = useState(false);
	const editingDirRef = useRef(false);
	const [dirInput, setDirInput] = useState(() => createTextInputState());
	const [dirError, setDirError] = useState<string | null>(null);
	const seenSignal = useRef(dirEditSignal);
	// biome-ignore lint/correctness/useExhaustiveDependencies: setEditing wraps stable setters + a ref
	useEffect(() => {
		if (dirEditSignal !== seenSignal.current) {
			seenSignal.current = dirEditSignal;
			if (onSetModelsDir) {
				setDirInput(createTextInputState());
				setDirError(null);
				setEditing(true);
			}
		}
	}, [dirEditSignal, onSetModelsDir]);

	// #42: notify at event time (not only from the effect) so the shell's
	// yield guard sees an open editor within the same key batch. The effect
	// still covers mount-consistency; both writes are idempotent.
	const editingChangeRef = useRef(onEditingChange);
	editingChangeRef.current = onEditingChange;
	const setEditing = (editing: boolean) => {
		editingDirRef.current = editing;
		setEditingDir(editing);
		editingChangeRef.current?.(editing || filteringRef.current);
	};
	const setFilterQueryBoth = (query: string) => {
		filterQueryRef.current = query;
		setFilterQuery(query);
	};
	const setFilteringBoth = (next: boolean) => {
		filteringRef.current = next;
		setFiltering(next);
		editingChangeRef.current?.(next || editingDir);
	};
	useEffect(() => {
		editingChangeRef.current?.(editingDir || filteringRef.current);
	}, [editingDir]);

	useScopedKeyboard(captureKeys && !editingDir, (key) => {
		// Event-time ownership (#42): a key batch can open the filter and
		// deliver the next key before React commits `filtering`.
		if (filteringRef.current) return;
		if (key.name === "m" && !key.ctrl && onSetModelsDir) {
			setDirInput(createTextInputState());
			setEditing(true);
			return;
		}
		// Tier 3: `/` opens the name filter, `s` cycles the sort mode.
		// Both are free on this tab (the table owns j/k/g/G/arrows, the
		// shell owns r/m/Ctrl-combos) and inert on the first-run panel.
		if (key.name === "/" && !key.ctrl && modelsDir !== null) {
			filterOpenerRef.current = true;
			setFilteringBoth(true);
			return;
		}
		if (key.name === "s" && !key.ctrl && modelsDir !== null) {
			const next = cycleSortMode(sortModeRef.current);
			sortModeRef.current = next;
			setSortMode(next);
			return;
		}
	});

	// Tier 3: while the filter owns the keyboard, printable keys edit the
	// query (j/k type — they do not navigate), arrows move the cursor,
	// Enter keeps the filter and exits, Esc clears it and exits. The
	// shell yields printables because filtering reports as editing.
	useScopedKeyboard(captureKeys, (key) => {
		if (!filteringRef.current || editingDirRef.current) return;
		if (filterOpenerRef.current) {
			filterOpenerRef.current = false;
			if (key.name === "/") return;
		}
		if (key.ctrl || key.meta) return;
		if (key.name === "up" || key.name === "down") {
			moveViewCursor(key.name === "down" ? 1 : -1);
			return;
		}
		const outcome = applyFilterKey(filterQueryRef.current, key);
		if (!outcome) return;
		setFilterQueryBoth(outcome.query);
		if (outcome.done) setFilteringBoth(false);
	});

	useScopedKeyboard(captureKeys && editingDir, (key) => {
		if (key.name === "return") {
			const trimmed = dirInput.buffer.trim();
			if (trimmed.length > 0) {
				// Validate BEFORE persisting: a bad path used to be written
				// to config.json first and fail later (Tier 2).
				const problem = validateDir?.(trimmed) ?? null;
				if (problem) {
					setDirError(problem);
					return;
				}
				onSetModelsDir?.(trimmed);
			}
			setEditing(false);
			return;
		}
		if (key.name === "escape") {
			setDirError(null);
			setEditing(false);
			return;
		}
	});

	const viewList = viewEntries(entries, filterQuery, sortMode);
	const rows = buildRows(viewList, iconSet);
	const filterBarVisible =
		filtering || filterQuery.length > 0 || sortMode !== "scan";

	const select = (index: number) => {
		if (onSelectIndex) onSelectIndex(index);
		else setSelected(index);
	};
	const fullSelected =
		selectedIndex !== undefined ? selectedIndex : internalSelected;
	const fullClamped = Math.min(fullSelected, Math.max(entries.length - 1, 0));
	const propEntry = entries[fullClamped];
	// External selection changes (boot restore, rescan auto-select) move
	// the cursor identity with them. View-local navigation sets the
	// cursor first, so this effect only fires on genuine outside changes.
	const lastPropPath = useRef<string | undefined>(undefined);
	// biome-ignore lint/correctness/useExhaustiveDependencies: setCursor wraps stable setters + a ref
	useEffect(() => {
		const path = propEntry?.path;
		if (path && path !== lastPropPath.current) {
			lastPropPath.current = path;
			setCursor(path);
		}
	}, [propEntry]);
	let viewIdx = cursorPath
		? viewList.findIndex((e) => e.path === cursorPath)
		: -1;
	if (viewIdx < 0 && propEntry)
		viewIdx = viewList.findIndex((e) => e.path === propEntry.path);
	if (viewIdx < 0) viewIdx = 0;
	const viewClamped = Math.min(viewIdx, Math.max(viewList.length - 1, 0));
	const current = viewList[viewClamped];
	// Navigate within the VIEW: translate to the full-list index for the
	// parent, but only when the model actually changes — a pure reorder
	// (typing in the filter, cycling sort) must not reset the
	// configurator (Tier 2 edit preservation).
	fullSelectedRef.current = fullClamped;
	const selectViewEntry = (e: ModelEntry | undefined) => {
		if (!e) return;
		setCursor(e.path);
		lastPropPath.current = e.path;
		const full = entries.indexOf(e);
		if (full >= 0 && full !== fullSelectedRef.current) {
			fullSelectedRef.current = full;
			select(full);
		}
	};
	const selectView = (vi: number) => {
		selectViewEntry(viewList[vi]);
	};
	// Arrow navigation while filtering derives the view from the refs:
	// the render-scope list can lag a same-batch query edit (#42).
	const moveViewCursor = (delta: number) => {
		const list = viewEntries(
			entries,
			filterQueryRef.current,
			sortModeRef.current,
		);
		if (list.length === 0) return;
		const cur = cursorPathRef.current
			? list.findIndex((e) => e.path === cursorPathRef.current)
			: -1;
		const base = cur < 0 ? 0 : cur;
		selectViewEntry(list[Math.min(Math.max(base + delta, 0), list.length - 1)]);
	};

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
						{dirError ? <text fg={theme.error}>{` ${dirError}`}</text> : null}
					</box>
				</TuiBox>
			) : modelsDir === null && !scanning ? (
				<TuiBox theme={theme} title="WELCOME" variant="double" accent>
					<box style={{ flexDirection: "column" }}>
						<text fg={theme.fgBright}>
							{withIcon(welcomeIcon, "No model directory configured yet.")}
						</text>
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
						title={`Models${modelsDir ? ` (${truncateMiddle(modelsDir, 28)})` : ""}`}
						width="60%"
						flexGrow={1}
						focused={focused}
					>
						<box style={{ flexDirection: "column", flexGrow: 1 }}>
							{filterBarVisible ? (
								<text fg={filtering ? theme.accent : theme.muted}>
									{filtering
										? ` /${filterQuery}_`
										: filterQuery
											? ` filter: "${filterQuery}"`
											: ""}
									{` · sort: ${sortModeLabel(sortMode)} · ${viewList.length}/${entries.length} models`}
								</text>
							) : null}
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
								viewport={
									filterBarVisible
										? Math.max(1, tableViewport - 1)
										: tableViewport
								}
								captureKeys={captureKeys && !filtering}
								focused={focused}
								selectedIndex={viewClamped}
								onSelect={() => onActivate?.()}
								onSelectionChange={(index) => selectView(index)}
							/>
							{scanning ? <text fg={theme.accent}> scanning...</text> : null}
							{scanError ? (
								<text fg={theme.error}> scan failed: {scanError}</text>
							) : null}
							{!scanning && rows.length === 0 && !scanError ? (
								<text fg={theme.warn}>
									{filterQuery && entries.length > 0
										? `no models match "${filterQuery}" — [Esc] clear filter`
										: withIcon(
												emptyIcon,
												"no .gguf files found — add models, [r] rescan · [m] change dir",
											)}
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
									<text fg={theme.muted}>(full-offload estimate)</text>
								</box>
							) : null}
						</box>
					</TuiBox>
				</box>
			)}

			<TuiBox theme={theme} title="Model launch target">
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
