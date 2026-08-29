import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { App } from "../../src/ui/app";
import { DEFAULT_THEME } from "../../src/ui/themes";

describe("catalog tab in app shell (P2-FR-15)", () => {
	it("key 5 opens the Components Catalog", async () => {
		const setup = await testRender(<App theme={DEFAULT_THEME} />, {
			width: 100,
			height: 30,
		});
		try {
			await act(async () => {
				await setup.flush();
			});
			await act(async () => {
				await setup.mockInput.pressKeys(["5"]);
			});
			await act(async () => {
				await setup.flush();
			});
			const frame = setup.captureCharFrame();
			expect(frame).toContain("Container Borders");
			expect(frame).toContain("Data Table");
		} finally {
			await act(async () => {
				setup.renderer.destroy();
			});
		}
	});

	it("key 1 returns to the app tab", async () => {
		const setup = await testRender(<App theme={DEFAULT_THEME} />, {
			width: 100,
			height: 30,
		});
		try {
			await act(async () => {
				await setup.flush();
			});
			await act(async () => {
				await setup.mockInput.pressKeys(["5"]);
			});
			await act(async () => {
				await setup.mockInput.pressKeys(["1"]);
			});
			await act(async () => {
				await setup.flush();
			});
			expect(setup.captureCharFrame()).toContain("Model Explorer");
		} finally {
			await act(async () => {
				setup.renderer.destroy();
			});
		}
	});
});
