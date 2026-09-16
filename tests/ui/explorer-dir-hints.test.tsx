import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { HelpOverlay } from "../../src/ui/components/help-overlay";
import { Explorer } from "../../src/ui/screens/explorer";
import { DEFAULT_THEME } from "../../src/ui/themes";

describe("models directory onboarding hints (phase3/models-dir-onboarding)", () => {
	it("WELCOME advertises [m] to set the directory, not just [s]", async () => {
		const setup = await testRender(
			<Explorer
				theme={DEFAULT_THEME}
				entries={[]}
				modelsDir={null}
				captureKeys={true}
			/>,
			{ width: 100, height: 26 },
		);
		await act(async () => {
			await setup.flush();
		});
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Welcome");
		expect(frame).toContain("[m]");
		await act(async () => {
			setup.renderer.destroy();
		});
	});

	it("pressing s with no dir set does nothing (no default-dir shortcut)", async () => {
		let calls = 0;
		const setup = await testRender(
			<Explorer
				theme={DEFAULT_THEME}
				entries={[]}
				modelsDir={null}
				onSetModelsDir={() => {
					calls++;
				}}
				captureKeys={true}
			/>,
			{ width: 100, height: 26 },
		);
		await act(async () => {
			await setup.flush();
		});
		await act(async () => {
			await setup.mockInput.pressKeys(["s"]);
		});
		await act(async () => {
			await setup.flush();
		});
		expect(calls).toBe(0);
		await act(async () => {
			setup.renderer.destroy();
		});
	});

	it("empty results hint that [m] changes the directory", async () => {
		const setup = await testRender(
			<Explorer
				theme={DEFAULT_THEME}
				entries={[]}
				modelsDir="/some/dir"
				captureKeys={true}
			/>,
			{ width: 100, height: 26 },
		);
		await act(async () => {
			await setup.flush();
		});
		expect(setup.captureCharFrame()).toContain("[m]");
		await act(async () => {
			setup.renderer.destroy();
		});
	});

	it("help overlay documents [m] on the Model Explorer tab", async () => {
		const setup = await testRender(
			<HelpOverlay
				theme={DEFAULT_THEME}
				open={true}
				tabName="Model Explorer"
			/>,
			{ width: 100, height: 30 },
		);
		await act(async () => {
			await setup.flush();
		});
		expect(setup.captureCharFrame()).toContain("[m]");
		await act(async () => {
			setup.renderer.destroy();
		});
	});
});
