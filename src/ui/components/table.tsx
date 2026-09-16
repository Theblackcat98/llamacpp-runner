import { useState } from "react";
import { useScopedKeyboard } from "../hooks/use-scoped-keyboard";
import type { Theme } from "../themes";
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
			setState((prev) => {
				const next = applyTableKey(prev, data, mapped);
				if (next.selected !== prev.selected) {
					onSelectionChange?.(next.selected, data[next.selected]);
				}
				return next;
			});
			return;
		}
		if ((mapped === "enter" || mapped === "return") && onSelect) {
			const sel = clampSelection(state, data).selected;
			const row = data[sel];
			if (row !== undefined) onSelect(sel, row);
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

	return (
		<text>
			{header ? (
				<span fg={focused ? theme.accent : theme.muted}>
					{formatHeader(columns)}
					{"\n"}
				</span>
			) : null}
			{rows.map(({ row, idx }) => (
				<span
					key={idx}
					bg={idx === view.selected && focused ? theme.focusBg : undefined}
					fg={idx === view.selected && focused ? theme.fgBright : theme.fg}
				>
					{formatRow(columns, row)}
					{"\n"}
				</span>
			))}
		</text>
	);
}
