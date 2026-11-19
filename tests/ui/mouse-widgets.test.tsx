import { afterEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { Checkbox } from "../../src/ui/components/checkbox";
import { ChipGroup } from "../../src/ui/components/chip-group";
import { Slider } from "../../src/ui/components/slider";
import { VirtualizedTable } from "../../src/ui/components/table";
import type { TableColumn } from "../../src/ui/components/table-state";
import { TOKYO_NIGHT } from "../../src/ui/themes";

const setups: { renderer: { destroy: () => void } }[] = [];
afterEach(async () => {
	for (const s of setups.splice(0)) {
		await act(async () => {
			s.renderer.destroy();
		});
	}
});

/** Locate a substring in the character frame (column, row). */
function findInFrame(frame: string, needle: string): { x: number; y: number } {
	const lines = frame.split("\n");
	for (let y = 0; y < lines.length; y++) {
		const x = lines[y]?.indexOf(needle) ?? -1;
		if (x >= 0) return { x, y };
	}
	throw new Error(`"${needle}" not in frame:\n${frame}`);
}

async function clickAt(
	setup: Awaited<ReturnType<typeof testRender>>,
	x: number,
	y: number,
): Promise<void> {
	await act(async () => {
		await setup.mockMouse.click(x, y);
	});
	await act(async () => {
		await setup.flush();
	});
}

interface Row {
	name: string;
}
const COLS: TableColumn<Row>[] = [
	{ key: "name", title: "NAME", width: 10, align: "left" },
];
const DATA: Row[] = Array.from({ length: 6 }, (_, i) => ({
	name: `model-${i}`,
}));

describe("table mouse support (Tier 3)", () => {
	it("click selects the row; wheel moves the selection", async () => {
		const seen: number[] = [];
		const setup = await testRender(
			<VirtualizedTable
				theme={TOKYO_NIGHT}
				columns={COLS}
				data={DATA}
				captureKeys
				focused
				viewport={4}
				onSelectionChange={(i) => {
					seen.push(i);
				}}
			/>,
			{ width: 30, height: 8 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		const at = findInFrame(setup.captureCharFrame(), "model-2");
		await clickAt(setup, at.x + 1, at.y);
		expect(seen).toEqual([2]);

		await act(async () => {
			await setup.mockMouse.scroll(at.x + 1, at.y, "down");
		});
		await act(async () => {
			await setup.flush();
		});
		expect(seen).toEqual([2, 3]);
	});

	it("double-click fires onSelect (the Enter equivalent)", async () => {
		const selected: number[] = [];
		const setup = await testRender(
			<VirtualizedTable
				theme={TOKYO_NIGHT}
				columns={COLS}
				data={DATA}
				captureKeys
				focused
				viewport={4}
				onSelect={(i) => {
					selected.push(i);
				}}
			/>,
			{ width: 30, height: 8 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		const at = findInFrame(setup.captureCharFrame(), "model-1");
		await act(async () => {
			await setup.mockMouse.doubleClick(at.x + 1, at.y);
		});
		await act(async () => {
			await setup.flush();
		});
		expect(selected).toEqual([1]);
	});

	it("keyboard navigation still works alongside the mouse handlers", async () => {
		const seen: number[] = [];
		const setup = await testRender(
			<VirtualizedTable
				theme={TOKYO_NIGHT}
				columns={COLS}
				data={DATA}
				captureKeys
				focused
				viewport={4}
				onSelectionChange={(i) => {
					seen.push(i);
				}}
			/>,
			{ width: 30, height: 8 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		await act(async () => {
			await setup.mockInput.pressKeys(["j", "j"]);
		});
		await act(async () => {
			await setup.flush();
		});
		expect(seen).toEqual([1, 2]);
	});
});

describe("checkbox / chip / slider mouse support (Tier 3)", () => {
	it("click toggles the checkbox; a disabled checkbox ignores clicks", async () => {
		let toggles = 0;
		const setup = await testRender(
			<Checkbox
				theme={TOKYO_NIGHT}
				captureKeys={false}
				checked={false}
				label="Flash Attention"
				onToggle={() => {
					toggles++;
				}}
			/>,
			{ width: 40, height: 4 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		const at = findInFrame(setup.captureCharFrame(), "Flash");
		await clickAt(setup, at.x, at.y);
		expect(toggles).toBe(1);

		let disabledToggles = 0;
		const off = await testRender(
			<Checkbox
				theme={TOKYO_NIGHT}
				captureKeys={false}
				checked={false}
				disabled
				label="Mlock"
				onToggle={() => {
					disabledToggles++;
				}}
			/>,
			{ width: 40, height: 4 },
		);
		setups.push(off);
		await act(async () => {
			await off.flush();
		});
		const atOff = findInFrame(off.captureCharFrame(), "Mlock");
		await clickAt(off, atOff.x, atOff.y);
		expect(disabledToggles).toBe(0);
	});

	it("click selects a chip", async () => {
		const picked: number[] = [];
		const setup = await testRender(
			<ChipGroup
				theme={TOKYO_NIGHT}
				captureKeys={false}
				chips={["4096", "8192", "16384"]}
				activeIndex={0}
				onSelect={(i) => {
					picked.push(i);
				}}
			/>,
			{ width: 40, height: 4 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		const at = findInFrame(setup.captureCharFrame(), "16384");
		await clickAt(setup, at.x + 1, at.y);
		expect(picked).toEqual([2]);
	});

	it("click on the slider track positions the value; label clicks ignored", async () => {
		const values: number[] = [];
		const setup = await testRender(
			<Slider
				theme={TOKYO_NIGHT}
				captureKeys={false}
				label="Batch"
				min={0}
				max={200}
				value={0}
				width={20}
				onChange={(v) => {
					values.push(v);
				}}
			/>,
			{ width: 50, height: 4 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		const frame = setup.captureCharFrame();
		const bracket = findInFrame(frame, "[");
		// Track columns are bracket+1 .. bracket+20; click the 11th cell
		// (offset 10 of 0..19) -> round(10/19*200) = 105.
		await clickAt(setup, bracket.x + 1 + 10, bracket.y);
		expect(values).toEqual([105]);

		const labelAt = findInFrame(setup.captureCharFrame(), "Batch");
		await clickAt(setup, labelAt.x + 1, labelAt.y);
		expect(values).toEqual([105]);
	});
});
