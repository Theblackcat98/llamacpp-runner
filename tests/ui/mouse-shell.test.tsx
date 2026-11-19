import { afterEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type Dispatch, type SetStateAction, useState } from "react";
import { App } from "../../src/ui/app";
import { createConfigurator } from "../../src/ui/logic/configurator-state";
import {
	appendLines,
	createDrawerState,
	type DrawerState,
} from "../../src/ui/logic/drawer-state";
import { DEFAULT_THEME } from "../../src/ui/themes";

const setups: { renderer: { destroy: () => void } }[] = [];
afterEach(async () => {
	for (const s of setups.splice(0)) {
		await act(async () => {
			s.renderer.destroy();
		});
	}
});

function findInFrame(frame: string, needle: string): { x: number; y: number } {
	const lines = frame.split("\n");
	for (let y = 0; y < lines.length; y++) {
		const x = lines[y]?.indexOf(needle) ?? -1;
		if (x >= 0) return { x, y };
	}
	throw new Error(`"${needle}" not in frame:\n${frame}`);
}

async function clickAt(
	setup: Awaited<ReturnType<typeof testRender>>,
	x: number,
	y: number,
): Promise<void> {
	await act(async () => {
		await setup.mockMouse.click(x, y);
	});
	await act(async () => {
		await setup.flush();
	});
}

const explorerControl = {
	entries: [],
	scanning: false,
	modelsDir: null,
	onRescan: () => {},
};
const presetsControl = {
	file: { version: 2, presets: [] },
	existingModelPaths: new Set<string>(),
};
const configuratorControl = {
	state: createConfigurator(null),
	setState: () => {},
};

describe("shell mouse support (Tier 3)", () => {
	it("clicking a tab switches to it, like its number key", async () => {
		const setup = await testRender(
			<App
				theme={DEFAULT_THEME}
				explorerControl={explorerControl}
				presetsControl={presetsControl}
				configuratorControl={configuratorControl}
			/>,
			{ width: 110, height: 30 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		const tab4 = findInFrame(setup.captureCharFrame(), "[4] Presets");
		await clickAt(setup, tab4.x + 2, tab4.y);
		expect(setup.captureCharFrame()).toContain("Actions");

		const tab2 = findInFrame(setup.captureCharFrame(), "[2] Launch Config");
		await clickAt(setup, tab2.x + 2, tab2.y);
		expect(setup.captureCharFrame()).toContain("Launch config");
	});

	it("clicking a palette action runs it and closes the palette", async () => {
		const themes: string[] = [];
		const setup = await testRender(
			<App
				theme={DEFAULT_THEME}
				explorerControl={explorerControl}
				paletteControl={{
					switchTheme: (name) => {
						themes.push(name);
					},
				}}
			/>,
			{ width: 110, height: 30 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		await act(async () => {
			await setup.mockInput.pressKey("p", { ctrl: true });
		});
		await act(async () => {
			await setup.flush();
		});
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Command palette");
		const at = findInFrame(frame, "Switch Theme: Nord");
		await clickAt(setup, at.x + 2, at.y);
		expect(themes).toEqual(["nord"]);
		expect(setup.captureCharFrame()).not.toContain("Command palette");
	});

	it("drawer title click toggles collapse; wheel scrolls the log", async () => {
		let drawerApi: {
			state: DrawerState;
			setState: Dispatch<SetStateAction<DrawerState>>;
		} | null = null;
		function Harness() {
			const [state, setState] = useState<DrawerState>(() => {
				let s = createDrawerState(6);
				for (let i = 0; i < 20; i++) {
					s = appendLines(s, [{ text: `log line ${i}`, stream: "out" }]);
				}
				return s;
			});
			drawerApi = { state, setState };
			return (
				<App
					theme={DEFAULT_THEME}
					explorerControl={explorerControl}
					drawerControl={{ state, setState }}
				/>
			);
		}
		const setup = await testRender(<Harness />, { width: 110, height: 30 });
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		let frame = setup.captureCharFrame();
		expect(frame).toContain("log line 19");
		expect(frame).not.toContain("log line 10");

		// Wheel up over the drawer scrolls back through the log.
		const consoleAt = findInFrame(frame, "Console");
		await act(async () => {
			await setup.mockMouse.scroll(consoleAt.x + 2, consoleAt.y + 2, "up");
		});
		await act(async () => {
			await setup.flush();
		});
		frame = setup.captureCharFrame();
		// One wheel-up step (-3 lines): the window moves 14-19 -> 11-16.
		expect(frame).toContain("log line 11");
		expect(frame).not.toContain("log line 19");
		expect(drawerApi).not.toBeNull();

		// Clicking the title row collapses; clicking it again expands.
		await clickAt(setup, consoleAt.x + 2, consoleAt.y);
		expect(setup.captureCharFrame()).toContain("o to expand");
		const collapsedAt = findInFrame(setup.captureCharFrame(), "Console");
		await clickAt(setup, collapsedAt.x + 2, collapsedAt.y);
		expect(setup.captureCharFrame()).not.toContain("o to expand");
	});

	it("double-clicking an Explorer row navigates to Launch Config", async () => {
		const entry = {
			name: "alpha.gguf",
			path: "/models/alpha.gguf",
			paths: ["/models/alpha.gguf"],
			totalBytes: 1000,
			architecture: "llama",
			quantName: "Q4_K_M",
			contextLength: 4096,
			blockCount: 32,
			embeddingLength: 4096,
			headCount: 32,
			headCountKv: 8,
		};
		const setup = await testRender(
			<App
				theme={DEFAULT_THEME}
				explorerControl={{
					entries: [entry],
					scanning: false,
					modelsDir: "/models",
					selectedIndex: 0,
					onSelectIndex: () => {},
					onRescan: () => {},
				}}
				configuratorControl={configuratorControl}
			/>,
			{ width: 110, height: 30 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		// The table row (the inspector also names the file, one line up).
		const at = findInFrame(setup.captureCharFrame(), "* alpha.gguf");
		// Two discrete clicks (each flushed, as real frames arrive) —
		// mockMouse.doubleClick inside one act() does not let the full
		// App tree process the first click before the second lands.
		await clickAt(setup, at.x + 1, at.y);
		await clickAt(setup, at.x + 1, at.y);
		expect(setup.captureCharFrame()).toContain("Launch config");
	});
});
