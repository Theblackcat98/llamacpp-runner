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

describe("kill-key routing regression (P0, §4, P5-FR-11)", () => {
	it("running server is killable via x when onKillOrphan also exists", async () => {
		const kills: string[] = [];
		const setup = await testRender(
			<App
				theme={DEFAULT_THEME}
				serverRunning={true}
				onKill={() => {
					kills.push("managed");
				}}
				onKillOrphan={() => {
					kills.push("orphan");
				}}
			/>,
			{ width: 100, height: 30 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});

		// First x: arms kill confirmation
		await press(setup, ["x"]);
		expect(kills).toEqual([]);
		expect(setup.captureCharFrame()).toContain("press x again to confirm");

		// Second x within window: executes managed kill (NOT orphan kill)
		await press(setup, ["x"]);
		expect(kills).toEqual(["managed"]);
	});

	it("k only triggers orphan kill, not managed kill", async () => {
		const kills: string[] = [];
		const setup = await testRender(
			<App
				theme={DEFAULT_THEME}
				serverRunning={true}
				onKill={() => {
					kills.push("managed");
				}}
				onKillOrphan={() => {
					kills.push("orphan");
				}}
			/>,
			{ width: 100, height: 30 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});

		// First k: arms orphan kill confirmation
		await press(setup, ["k"]);
		expect(kills).toEqual([]);
		expect(setup.captureCharFrame()).toContain("press k again");

		// Second k: executes orphan kill only
		await press(setup, ["k"]);
		expect(kills).toEqual(["orphan"]);
	});

	it("Ctrl+k is guarded and does not arm orphan kill", async () => {
		const kills: string[] = [];
		const setup = await testRender(
			<App
				theme={DEFAULT_THEME}
				serverRunning={true}
				onKill={() => {
					kills.push("managed");
				}}
				onKillOrphan={() => {
					kills.push("orphan");
				}}
			/>,
			{ width: 100, height: 30 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});

		// Send Ctrl+k via mockInput
		await act(async () => {
			await setup.mockInput.pressKey("k", { ctrl: true });
		});
		await act(async () => {
			await setup.flush();
		});

		expect(kills).toEqual([]);
		expect(setup.captureCharFrame()).not.toContain("press k again");
	});
});
