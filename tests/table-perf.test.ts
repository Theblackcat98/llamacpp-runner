import { describe, expect, it } from "bun:test";
import {
	applyTableKey,
	createTableState,
	visibleRows,
} from "../src/ui/components/table-state";

interface Row {
	id: number;
	name: string;
	size: string;
}

const COLS = [
	{ key: "id" as const, title: "ID", width: 6, align: "right" as const },
	{ key: "name" as const, title: "NAME", width: 20, align: "left" as const },
	{ key: "size" as const, title: "SIZE", width: 8, align: "left" as const },
];

const data: Row[] = Array.from({ length: 10_000 }, (_, i) => ({
	id: i,
	name: `model-${i}`,
	size: `${(i % 70) + 1}GB`,
}));

describe("virtualized table perf (P2-NFR-01)", () => {
	it("10k rows: keystroke + window computation well under 50ms budget", () => {
		let s = createTableState<Row>({ columns: COLS, viewport: 30 });
		const t0 = performance.now();
		for (let i = 0; i < 100; i++) {
			s = applyTableKey(s, data, i % 2 === 0 ? "j" : "G");
			const rows = visibleRows(s, data);
			expect(rows).toHaveLength(30);
		}
		const perKeystrokeMs = (performance.now() - t0) / 100;
		expect(perKeystrokeMs).toBeLessThan(50);
	});
});
