// biome-ignore-all lint/a11y/noStaticElementInteractions: OpenTUI renderables are terminal cells, not DOM elements; every mouse action here mirrors an existing keyboard binding (Tier 3)
import type { MouseEvent } from "@opentui/core";
import { useEffect, useRef, useState } from "react";
import { useScopedKeyboard } from "../hooks/use-scoped-keyboard";
import type { Theme } from "../themes";
import { toTitleCase } from "../title-case";
import {
	applyTableKey,
	clampSelection,
	createTableState,
	formatHeader,
	formatRow,
	selectRow,
	type TableColumn,
	type TableState,
	windowStart,
} from "./table-state";

export interface VirtualizedTableProps<T> {
	theme: Theme;
	columns: TableColumn<T>[];
	data: T[];
	captureKeys: boolean;
	focused?: boolean;
	viewport: number;
	header?: boolean;
	/** Controlled selection (Tier 3): when provided, rendering follows
	 * this index while key/click navigation still reports through
	 * onSelectionChange — the parent owns the truth (the Explorer's
	 * filter view maps it back to a model identity). */
	selectedIndex?: number;
	onSelect?: (index: number, row: T) => void;
	onSelectionChange?: (index: number, row: T | undefined) => void;
}

/** Window (ms) in which a second click on the same row is a double-click. */
const DOUBLE_CLICK_MS = 400;

/**
 * Renders ONLY the visible window of rows (P2-FR-06). Row selection with
 * j/k/arrows, g/G jumps, Enter select. Keys run through the pure reducer.
 *
 * Tier 3 mouse (additive — keyboard stays primary): a click selects the
 * row, a double-click fires onSelect (the Enter equivalent), and the
 * wheel moves the selection. Rows are individual boxes because OpenTUI
 * mouse events target renderables, not spans inside a text node.
 */
export function VirtualizedTable<T>({
	theme,
	columns,
	data,
	captureKeys,
	focused = false,
	viewport,
	header = true,
	selectedIndex,
	onSelect,
	onSelectionChange,
}: VirtualizedTableProps<T>) {
	const [state, setStateRaw] = useState<TableState<T>>(() =>
		createTableState({ columns, viewport }),
	);
	const stateRef = useRef(state);
	const setState = (next: TableState<T>) => {
		stateRef.current = next;
		setStateRaw(next);
	};
	const lastClick = useRef<{ index: number; at: number } | null>(null);

	const controlled = selectedIndex !== undefined;
	const effective: TableState<T> = controlled
		? { ...state, selected: selectedIndex }
		: state;
	const view = clampSelection(effective, data);
	// Event-time mirror of the effective selection (#42 pattern): key and
	// mouse batches can arrive before React commits, so handlers read the
	// ref, never the render-scope value.
	const selRef = useRef(view.selected);
	useEffect(() => {
		selRef.current = view.selected;
	});

	// Notify the parent from the event handler itself (never inside a
	// setState updater, which setState'd the parent mid-render). The ref
	// guard keeps repeat notifications for the same index from firing.
	const prevNotified = useRef(view.selected);
	const commitSelection = (next: TableState<T>) => {
		setState(next);
		const sel = clampSelection(next, data).selected;
		selRef.current = sel;
		if (sel !== prevNotified.current) {
			prevNotified.current = sel;
			onSelectionChange?.(sel, data[sel]);
		}
	};
	const baseForNav = (): TableState<T> => ({
		...stateRef.current,
		selected: selRef.current,
	});

	useScopedKeyboard(captureKeys && focused, (key) => {
		const name = key.name ?? "";
		const mapped = name === "up" ? "k" : name === "down" ? "j" : name;
		if (["k", "j", "g", "G"].includes(mapped)) {
			commitSelection(applyTableKey(baseForNav(), data, mapped));
			return;
		}
		if ((mapped === "enter" || mapped === "return") && onSelect) {
			const sel = selRef.current;
			const row = data[sel];
			if (row !== undefined) onSelect(sel, row);
		}
	});

	// Data shrinks (uncontrolled) can clamp the selection without any
	// event — the parent still hears about it after commit. In controlled
	// mode the parent owns the index, so the effect only re-syncs the ref.
	useEffect(() => {
		const sel = view.selected;
		selRef.current = sel;
		if (controlled) {
			prevNotified.current = sel;
			return;
		}
		if (sel !== prevNotified.current) {
			prevNotified.current = sel;
			onSelectionChange?.(sel, data[sel]);
		}
	});

	const start = windowStart(view, data);
	const end = Math.min(start + viewport, data.length);
	const rows: { row: T; idx: number }[] = [];
	for (let i = start; i < end; i++) {
		const row = data[i];
		if (row !== undefined) rows.push({ row, idx: i });
	}
	// #47: column headers render in title case, not ALL-CAPS.
	const casedColumns = columns.map((c) => ({
		...c,
		title: toTitleCase(c.title),
	}));

	const handleRowMouseDown = (idx: number) => (event: MouseEvent) => {
		if (event.button !== 0) return;
		event.stopPropagation();
		const now = Date.now();
		const last = lastClick.current;
		if (
			onSelect &&
			last !== null &&
			last.index === idx &&
			now - last.at <= DOUBLE_CLICK_MS
		) {
			lastClick.current = null;
			const row = data[idx];
			if (row !== undefined) onSelect(idx, row);
			return;
		}
		lastClick.current = { index: idx, at: now };
		commitSelection(selectRow(baseForNav(), data, idx));
	};

	const handleScroll = (event: MouseEvent) => {
		const dir = event.scroll?.direction;
		if (dir !== "up" && dir !== "down") return;
		event.stopPropagation();
		commitSelection(
			applyTableKey(baseForNav(), data, dir === "up" ? "k" : "j"),
		);
	};

	return (
		<box style={{ flexDirection: "column" }} onMouseScroll={handleScroll}>
			{header ? (
				<text fg={focused ? theme.accent : theme.muted}>
					{formatHeader(casedColumns)}
				</text>
			) : null}
			{rows.map(({ row, idx }) => (
				<box
					key={idx}
					style={{ height: 1 }}
					onMouseDown={handleRowMouseDown(idx)}
				>
					<text
						bg={idx === view.selected && focused ? theme.focusBg : undefined}
						fg={idx === view.selected && focused ? theme.fgBright : theme.fg}
					>
						{formatRow(casedColumns, row)}
					</text>
				</box>
			))}
			{/* The pre-mouse table was one text node whose content ended in
			    a newline — one trailing blank line. Keep it so sibling
			    content below the table never shifts (empty-dir golden). */}
			<box style={{ height: 1 }}>
				<text>{""}</text>
			</box>
		</box>
	);
}
