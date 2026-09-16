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
	onSelect?: (index: number, row: T) => void;
	onSelectionChange?: (index: number, row: T | undefined) => void;
}

/**
 * Renders ONLY the visible window of rows (P2-FR-06). Row selection with
 * j/k/arrows, g/G jumps, Enter select. Keys run through the pure reducer.
 */
export function VirtualizedTable<T>({
	theme,
	columns,
	data,
	captureKeys,
	focused = false,
	viewport,
	header = true,
	onSelect,
	onSelectionChange,
}: VirtualizedTableProps<T>) {
	const [state, setState] = useState<TableState<T>>(() =>
		createTableState({ columns, viewport }),
	);

	useScopedKeyboard(captureKeys && focused, (key) => {
		const name = key.name ?? "";
		const mapped = name === "up" ? "k" : name === "down" ? "j" : name;
		if (["k", "j", "g", "G"].includes(mapped)) {
			// The updater stays pure: the parent notification moves to the
			// effect below. Calling onSelectionChange inside the updater
			// setState'd the parent mid-render ("Cannot update a component
			// while rendering a different component").
			setState((prev) => applyTableKey(prev, data, mapped));
			return;
		}
		if ((mapped === "enter" || mapped === "return") && onSelect) {
			const sel = clampSelection(state, data).selected;
			const row = data[sel];
			if (row !== undefined) onSelect(sel, row);
		}
	});

	// Notify the parent after commit, never during this component's update.
	const prevNotified = useRef(clampSelection(state, data).selected);
	useEffect(() => {
		const sel = clampSelection(state, data).selected;
		if (sel !== prevNotified.current) {
			prevNotified.current = sel;
			onSelectionChange?.(sel, data[sel]);
		}
	});

	const view = clampSelection(state, data);
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

	return (
		<text>
			{header ? (
				<span fg={focused ? theme.accent : theme.muted}>
					{formatHeader(casedColumns)}
					{"\n"}
				</span>
			) : null}
			{rows.map(({ row, idx }) => (
				<span
					key={idx}
					bg={idx === view.selected && focused ? theme.focusBg : undefined}
					fg={idx === view.selected && focused ? theme.fgBright : theme.fg}
				>
					{formatRow(casedColumns, row)}
					{"\n"}
				</span>
			))}
		</text>
	);
}
