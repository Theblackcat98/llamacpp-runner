import { describe, expect, it } from "bun:test";
import { TuiBox } from "../../src/ui/components/box";
import { TOKYO_NIGHT } from "../../src/ui/themes";
import { renderWithAct, teardownWithAct } from "./golden/harness";

async function renderBox(variant?: "single" | "double" | "rounded" | "heavy") {
	const setup = await renderWithAct(
		<TuiBox theme={TOKYO_NIGHT} variant={variant} width={12} height={4}>
			<text>hi</text>
		</TuiBox>,
		{ width: 20, height: 8 },
	);
	const frame = setup.captureCharFrame();
	await teardownWithAct(setup);
	return frame;
}

describe("TuiBox border variant default (#46)", () => {
	it("defaults to rounded corners", async () => {
		const frame = await renderBox(undefined);
		expect(frame).toContain("╭");
		expect(frame).toContain("╮");
		expect(frame).not.toContain("┌");
	});

	it("still honors explicit single and double variants", async () => {
		expect(await renderBox("single")).toContain("┌");
		expect(await renderBox("double")).toContain("╔");
	});
});
