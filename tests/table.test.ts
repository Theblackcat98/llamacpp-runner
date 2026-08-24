import { describe, expect, it } from "bun:test";
import {
	applyTableKey,
	clampSelection,
	createTableState,
	formatRow,
	visibleRows,
} from "../src/ui/components/table-state";

interface Row {
	id: number;
	name: string;
	size: string;
}

const COLS = [
	{ key: "id" as const, title: "ID", width: 4, align: "right" as const },
	{ key: "name" as const, title: "NAME", width: 8, align: "left" as const },
	{ key: "size" as const, title: "SIZE", width: 6, align: "left" as const },
];

function rows(n: number): Row[] {
	return Array.from({ length: n }, (_, i) => ({
		id: i,
		name: `model-${i}`,
		size: `${i}GB`,
	}));
}

describe("virtualized table state (P2-FR-06)", () => {
	it("renders only the visible window", () => {
		let s = createTableState<Row>({ columns: COLS, viewport: 3 });
		s = applyTableKey(s, rows(100), "down");
		expect(visibleRows(s, rows(100)).map((r) => r.id)).toEqual([0, 1, 2]);
	});

	it("j/k/arrows move selection and scroll the window", () => {
		const data = rows(10);
		let s = createTableState<Row>({ columns: COLS, viewport: 2 });
		for (let i = 0; i < 4; i++) s = applyTableKey(s, data, "j");
		expect(s.selected).toBe(4);
		expect(visibleRows(s, data).map((r) => r.id)).toEqual([3, 4]);
	});

	it("g/G jump to top and bottom", () => {
		const data = rows(50);
		let s = createTableState<Row>({ columns: COLS, viewport: 3 });
		s = applyTableKey(s, data, "G");
		expect(s.selected).toBe(49);
		expect(visibleRows(s, data).map((r) => r.id)).toEqual([47, 48, 49]);
		s = applyTableKey(s, data, "g");
		expect(s.selected).toBe(0);
	});

	it("clamps selection when data shrinks", () => {
		let s = createTableState<Row>({ columns: COLS, viewport: 3 });
		s = applyTableKey(s, rows(20), "G");
		const small = rows(2);
		s = clampSelection(s, small);
		expect(visibleRows(s, small)).toHaveLength(2);
		expect(s.selected).toBeLessThan(2);
	});

	it("formats cells with per-column align and pads header", () => {
		expect(formatRow(COLS, { id: 1, name: "model-1", size: "1GB" })).toBe(
			"   1 model-1  1GB   ",
		);
	});
});
