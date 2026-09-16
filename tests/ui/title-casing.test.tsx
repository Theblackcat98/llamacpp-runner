import { describe, expect, it } from "bun:test";
import { TuiBox } from "../../src/ui/components/box";
import { VirtualizedTable } from "../../src/ui/components/table";
import { TOKYO_NIGHT } from "../../src/ui/themes";
import { renderWithAct, teardownWithAct } from "./golden/harness";

describe("title casing in chrome (#47)", () => {
	it("TuiBox renders ALL-CAPS titles in title case", async () => {
		const setup = await renderWithAct(
			<TuiBox
				theme={TOKYO_NIGHT}
				title="QUICK LAUNCH COMMAND PREVIEW"
				width={44}
				height={5}
			>
				<text>hi</text>
			</TuiBox>,
			{ width: 48, height: 8 },
		);
		const frame = setup.captureCharFrame();
		await teardownWithAct(setup);
		expect(frame).toContain("Quick launch command preview");
		expect(frame).not.toContain("QUICK LAUNCH COMMAND PREVIEW");
	});

	it("TuiBox leaves mixed-case titles alone", async () => {
		const setup = await renderWithAct(
			<TuiBox
				theme={TOKYO_NIGHT}
				title="Container Borders"
				width={24}
				height={4}
			>
				<text>hi</text>
			</TuiBox>,
			{ width: 28, height: 8 },
		);
		const frame = setup.captureCharFrame();
		await teardownWithAct(setup);
		expect(frame).toContain("Container Borders");
	});

	it("table column headers render in title case", async () => {
		const setup = await renderWithAct(
			<VirtualizedTable
				theme={TOKYO_NIGHT}
				columns={[
					{ key: "name", title: "NAME", width: 10, align: "left" },
					{ key: "size", title: "SIZE", width: 8, align: "right" },
				]}
				data={[{ name: "a.gguf", size: "1" }]}
				captureKeys={false}
				viewport={4}
			/>,
			{ width: 30, height: 8 },
		);
		const frame = setup.captureCharFrame();
		await teardownWithAct(setup);
		expect(frame).toContain("Name");
		expect(frame).toContain("Size");
		expect(frame).not.toMatch(/\bNAME\b/);
	});
});
