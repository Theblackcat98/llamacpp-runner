import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { App } from "../../src/ui/app";
import { DEFAULT_THEME } from "../../src/ui/themes";

describe("production shell tab contract", () => {
	it("does not expose the development Catalog as a production tab", async () => {
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
			expect(frame).not.toContain("Container Borders");
			expect(frame).not.toContain("Data Table");
		} finally {
			await act(async () => {
				setup.renderer.destroy();
			});
		}
	});

	it("key 1 remains on the first production tab", async () => {
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
