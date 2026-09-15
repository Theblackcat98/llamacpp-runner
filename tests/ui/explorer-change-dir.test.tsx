import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { Explorer } from "../../src/ui/screens/explorer";
import { DEFAULT_THEME } from "../../src/ui/themes";

describe("explorer change directory in TUI", () => {
	it("press m opens directory input, typing and Enter submits onSetModelsDir", async () => {
		let chosenDir: string | null = null;
		const setup = await testRender(
			<Explorer
				theme={DEFAULT_THEME}
				entries={[]}
				modelsDir="/initial/dir"
				onSetModelsDir={(dir) => {
					chosenDir = dir;
				}}
				captureKeys={true}
			/>,
			{ width: 100, height: 26 },
		);

		await act(async () => {
			await setup.flush();
		});

		// Press 'm' to open directory prompt
		await act(async () => {
			await setup.mockInput.pressKeys(["m"]);
		});
		await act(async () => {
			await setup.flush();
		});

		const promptFrame = setup.captureCharFrame();
		expect(promptFrame).toContain("SET MODELS DIRECTORY");

		// Type directory path
		await act(async () => {
			await setup.mockInput.pressKeys([
				"/",
				"m",
				"y",
				"-",
				"m",
				"o",
				"d",
				"e",
				"l",
				"s",
			]);
		});
		await act(async () => {
			await setup.flush();
		});

		// Press Enter to submit
		await act(async () => {
			await setup.mockInput.pressKeys(["\r"]);
		});
		await act(async () => {
			await setup.flush();
		});

		expect<string | null>(chosenDir).toBe("/my-models");
		await act(async () => {
			setup.renderer.destroy();
		});
	});

	it("press escape closes directory input without submitting", async () => {
		let chosenDir: string | null = null;
		const setup = await testRender(
			<Explorer
				theme={DEFAULT_THEME}
				entries={[]}
				modelsDir="/initial/dir"
				onSetModelsDir={(dir) => {
					chosenDir = dir;
				}}
				captureKeys={true}
			/>,
			{ width: 100, height: 26 },
		);

		await act(async () => {
			await setup.flush();
		});

		// Press 'm' to open directory prompt
		await act(async () => {
			await setup.mockInput.pressKeys(["m"]);
		});
		await act(async () => {
			await setup.flush();
		});

		expect(setup.captureCharFrame()).toContain("SET MODELS DIRECTORY");

		// Press Escape to cancel
		await act(async () => {
			await setup.mockInput.pressKeys(["\x1b"]);
		});
		// lone ESC is held by OpenTUI's escape-disambiguation timer; let it flush
		await act(async () => {
			await new Promise((r) => setTimeout(r, 120));
			await setup.flush();
		});

		expect(setup.captureCharFrame()).not.toContain("SET MODELS DIRECTORY");
		expect(chosenDir).toBe(null);

		await act(async () => {
			setup.renderer.destroy();
		});
	});
});
