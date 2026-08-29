import { describe, expect, it } from "bun:test";
import { Explorer } from "../../src/ui/screens/explorer";
import { TOKYO_NIGHT } from "../../src/ui/themes";
import {
	expectGoldenFrame,
	renderWithAct,
	teardownWithAct,
} from "./golden/harness";

/**
 * §7 "First run, no models dir" (P5-FR-08): onboarding prompt renders when
 * no model directory is configured.
 */
describe("first-run onboarding (§7)", () => {
	it("renders onboarding prompt when modelsDir is null", async () => {
		await expectGoldenFrame(
			"explorer-first-run",
			<Explorer theme={TOKYO_NIGHT} entries={[]} modelsDir={null} />,
			{ width: 100, height: 12 },
		);
	});

	it("onboarding names the [s] shortcut and scan command", async () => {
		const setup = await renderWithAct(
			<Explorer theme={TOKYO_NIGHT} entries={[]} modelsDir={null} />,
			{ width: 100, height: 12 },
		);
		const frame = setup.captureCharFrame();
		await teardownWithAct(setup);
		expect(frame).toContain("No model directory configured");
		expect(frame).toContain("[s] use ~/models/llm");
	});
});
