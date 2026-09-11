import { afterEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { App } from "../../src/ui/app";
import { DEFAULT_THEME } from "../../src/ui/themes";

const setups: { renderer: { destroy: () => void } }[] = [];
afterEach(async () => {
	for (const s of setups.splice(0)) {
		await act(async () => {
			s.renderer.destroy();
		});
	}
});

async function press(
	setup: Awaited<ReturnType<typeof testRender>>,
	keys: string[],
): Promise<void> {
	await act(async () => {
		await setup.mockInput.pressKeys(keys);
	});
	await act(async () => {
		await setup.flush();
	});
}

/**
 * F8: killing the orphaned server is destructive, so `k` arms and a second
 * `k` within 2 s executes — a single stray keypress never kills it.
 */
describe("orphan kill confirmation (F8)", () => {
	it("first k arms (no kill); second k within window kills", async () => {
		const kills: number[] = [];
		const setup = await testRender(
			<App
				theme={DEFAULT_THEME}
				onKillOrphan={() => {
					kills.push(1);
				}}
			/>,
			{ width: 100, height: 30 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});

		await press(setup, ["k"]);
		expect(kills).toEqual([]);
		expect(setup.captureCharFrame()).toContain("press k again");

		await press(setup, ["k"]);
		expect(kills).toEqual([1]);
	});

	it("a lone k never kills the orphan", async () => {
		const kills: number[] = [];
		const setup = await testRender(
			<App
				theme={DEFAULT_THEME}
				onKillOrphan={() => {
					kills.push(1);
				}}
			/>,
			{ width: 100, height: 30 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});

		await press(setup, ["k"]);
		expect(kills).toEqual([]);
	});
});
