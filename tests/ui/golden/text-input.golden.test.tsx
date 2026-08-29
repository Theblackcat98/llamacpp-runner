import { describe, expect, it } from "bun:test";
import { act } from "react";
import { TextInput } from "../../../src/ui/components/text-input";
import { TOKYO_NIGHT } from "../../../src/ui/themes";
import { expectGoldenFrame } from "./harness";

describe("text input golden frames (P2-FR-01)", () => {
	it("renders typed content with a visible cursor and INS marker", async () => {
		await expectGoldenFrame(
			"text-input",
			<TextInput theme={TOKYO_NIGHT} captureKeys initial="80" width={20} />,
			{ width: 40, height: 3 },
		);
	});

	it("typing and overwrite toggle update the frame", async () => {
		const setup = await import("@opentui/react/test-utils").then((m) =>
			m.testRender(<TextInput theme={TOKYO_NIGHT} captureKeys width={20} />, {
				width: 40,
				height: 3,
			}),
		);
		await act(async () => {
			await setup.mockInput.pressKeys(["p", "o", "r", "t"]);
		});
		await act(async () => {
			await setup.flush();
		});
		expect(setup.captureCharFrame()).toContain("port");
		await act(async () => {
			await setup.mockInput.pressKeys(["\x1b[2~"]);
		});
		await act(async () => {
			await setup.flush();
		});
		expect(setup.captureCharFrame()).toContain("OVR");
		await act(async () => {
			setup.renderer.destroy();
		});
	});
});
