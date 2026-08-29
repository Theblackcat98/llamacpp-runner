import { describe, expect, it } from "bun:test";
import { act } from "react";
import { ScrollPane } from "../../../src/ui/components/scroll-pane";
import { VirtualizedTable } from "../../../src/ui/components/table";
import type { TableColumn } from "../../../src/ui/components/table-state";
import { TOKYO_NIGHT } from "../../../src/ui/themes";
import { expectGoldenFrame, renderWithAct, teardownWithAct } from "./harness";

interface Row {
	id: number;
	name: string;
	size: string;
}

const COLS: TableColumn<Row>[] = [
	{ key: "id", title: "ID", width: 4, align: "right" },
	{ key: "name", title: "NAME", width: 9, align: "left" },
	{ key: "size", title: "SIZE", width: 5, align: "left" },
];

const rows: Row[] = Array.from({ length: 6 }, (_, i) => ({
	id: i,
	name: `model-${i}`,
	size: `${i}GB`,
}));

const LINES = Array.from({ length: 20 }, (_, i) => `log line ${i}`);

describe("table + scroll pane golden frames (P2-FR-06,07)", () => {
	it("table renders header plus visible window only", async () => {
		await expectGoldenFrame(
			"table",
			<VirtualizedTable
				theme={TOKYO_NIGHT}
				columns={COLS}
				data={rows}
				captureKeys
				focused
				viewport={3}
			/>,
			{ width: 30, height: 5 },
		);
	});

	it("scroll pane pins to tail and pauses on up-arrow", async () => {
		const setup = await renderWithAct(
			<ScrollPane
				theme={TOKYO_NIGHT}
				captureKeys
				focused
				contentLines={LINES}
				viewport={3}
			/>,
			{ width: 30, height: 4 },
		);
		expect(setup.captureCharFrame()).toContain("log line 19");
		await act(async () => {
			await setup.mockInput.pressKeys(["\x1b[A"]);
		});
		await act(async () => {
			await setup.flush();
		});
		const frame = setup.captureCharFrame();
		expect(frame).toContain("log line 16");
		expect(frame).not.toContain("log line 19");
		await teardownWithAct(setup);
	});
});
