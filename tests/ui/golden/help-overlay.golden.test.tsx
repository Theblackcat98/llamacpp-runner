import { describe, it } from "bun:test";
import { HelpOverlay } from "../../../src/ui/components/help-overlay";
import { TOKYO_NIGHT } from "../../../src/ui/themes";
import { expectGoldenFrame } from "./harness";

describe("help overlay golden frame (F15)", () => {
	it("renders global + tab bindings", async () => {
		await expectGoldenFrame(
			"help-overlay",
			<HelpOverlay theme={TOKYO_NIGHT} open tabName="Launch Config" />,
			{ width: 100, height: 24 },
		);
	});
});
