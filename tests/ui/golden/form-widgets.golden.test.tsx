import { describe, expect, it } from "bun:test";
import { act, useState } from "react";
import { Checkbox } from "../../../src/ui/components/checkbox";
import { ChipGroup } from "../../../src/ui/components/chip-group";
import { CyclingSelect } from "../../../src/ui/components/cycling-select";
import { Slider } from "../../../src/ui/components/slider";
import { TOKYO_NIGHT } from "../../../src/ui/themes";
import { expectGoldenFrame } from "./harness";

function DemoRow() {
	const [checked, setChecked] = useState(false);
	const [ngl, setNgl] = useState(33);
	return (
		<box>
			<Slider
				theme={TOKYO_NIGHT}
				captureKeys
				focused
				label="ngl"
				min={0}
				max={99}
				value={ngl}
				onChange={setNgl}
			/>
			<Checkbox
				theme={TOKYO_NIGHT}
				captureKeys
				checked={checked}
				onToggle={() => setChecked(true)}
				label="mmap"
			/>
			<CyclingSelect
				theme={TOKYO_NIGHT}
				captureKeys
				label="backend"
				options={["cpu", "cuda", "vulkan"]}
				index={1}
			/>
			<ChipGroup
				theme={TOKYO_NIGHT}
				captureKeys
				chips={["q4", "q5", "q8"]}
				activeIndex={2}
			/>
			<text>{checked ? "on" : "off"}</text>
		</box>
	);
}

describe("form widgets golden frames (P2-FR-02..05)", () => {
	it("renders slider, checkbox, cycling select, chip group", async () => {
		await expectGoldenFrame("form-widgets", <DemoRow />, {
			width: 44,
			height: 7,
		});
	});

	it("keyboard drives slider, checkbox, chips, select", async () => {
		const { testRender } = await import("@opentui/react/test-utils");
		const setup = await testRender(<DemoRow />, { width: 44, height: 7 });
		await setup.flush();
		await act(async () => {
			await setup.mockInput.pressKeys(["\x1b[1;2C"]);
		});
		await act(async () => {
			await setup.mockInput.pressKeys([" "]);
		});
		await act(async () => {
			await setup.mockInput.pressKeys(["\r"]);
		});
		await setup.flush();
		expect(setup.captureCharFrame()).toContain("43/99");
		expect(setup.captureCharFrame()).toContain("[x] mmap");
		setup.renderer.destroy();
	});
});
