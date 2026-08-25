import { describe, expect, it } from "bun:test";
import { Explorer } from "../../src/ui/screens/explorer";
import { TOKYO_NIGHT } from "../../src/ui/themes";
import { expectGoldenFrame } from "./golden/harness";

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
		const { testRender } = await import("@opentui/react/test-utils");
		const setup = await testRender(
			<Explorer theme={TOKYO_NIGHT} entries={[]} modelsDir={null} />,
			{ width: 100, height: 12 },
		);
		await setup.flush();
		const frame = setup.captureCharFrame();
		setup.renderer.destroy();
		expect(frame).toContain("No model directory configured");
		expect(frame).toContain("[s] use ~/models/llm");
	});
});
