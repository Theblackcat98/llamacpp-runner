export interface TableColumn<T> {
	key: keyof T;
	title: string;
	width: number;
	align: "left" | "right";
}

export interface TableState<T> {
	columns: TableColumn<T>[];
	viewport: number;
	selected: number;
	scrollTop: number;
}

export function createTableState<T>(options: {
	columns: TableColumn<T>[];
	viewport: number;
}): TableState<T> {
	return {
		columns: options.columns,
		viewport: options.viewport,
		selected: 0,
		scrollTop: 0,
	};
}

function clampWindow<T>(state: TableState<T>, data: T[]): TableState<T> {
	const n = data.length;
	if (n === 0) return { ...state, selected: 0, scrollTop: 0 };
	const selected = Math.min(Math.max(state.selected, 0), n - 1);
	let scrollTop = Math.min(state.scrollTop, Math.max(0, n - state.viewport));
	if (selected < scrollTop) scrollTop = selected;
	if (selected >= scrollTop + state.viewport)
		scrollTop = selected - state.viewport + 1;
	return { ...state, selected, scrollTop };
}

export function applyTableKey<T>(
	state: TableState<T>,
	data: T[],
	keyName: string,
): TableState<T> {
	const delta =
		keyName === "down" || keyName === "j"
			? 1
			: keyName === "up" || keyName === "k"
				? -1
				: keyName === "G"
					? Number.POSITIVE_INFINITY
					: keyName === "g"
						? Number.NEGATIVE_INFINITY
						: 0;
	if (delta === 0) return state;
	const target =
		delta === Number.POSITIVE_INFINITY
			? data.length - 1
			: delta === Number.NEGATIVE_INFINITY
				? 0
				: state.selected + delta;
	return clampWindow({ ...state, selected: target }, data);
}

export function clampSelection<T>(
	state: TableState<T>,
	data: T[],
): TableState<T> {
	return clampWindow(state, data);
}

export function visibleRows<T>(state: TableState<T>, data: T[]): T[] {
	if (data.length === 0) return [];
	const clamped = clampWindow(state, data);
	const end = Math.min(clamped.scrollTop + state.viewport, data.length);
	return data.slice(clamped.scrollTop, end);
}

export function formatCell<T>(col: TableColumn<T>, row: T): string {
	const raw = String(row[col.key] ?? "");
	const pad = Math.max(0, col.width - raw.length);
	const spaces = " ".repeat(pad);
	return col.align === "right" ? spaces + raw : raw + spaces;
}

export function formatRow<T>(columns: TableColumn<T>[], row: T): string {
	return columns.map((c) => formatCell(c, row)).join(" ");
}

export function formatHeader<T>(columns: TableColumn<T>[]): string {
	const cells = columns.map((c) => {
		const pad = Math.max(0, c.width - c.title.length);
		return c.title + " ".repeat(pad);
	});
	return cells.join(" ");
}

export function windowStart<T>(state: TableState<T>, data: T[]): number {
	if (data.length === 0) return 0;
	return clampWindow(state, data).scrollTop;
}
