import { afterEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import type { Preset, PresetFile } from "../../src/core/store/presets";
import { App } from "../../src/ui/app";
import { createConfigurator } from "../../src/ui/logic/configurator-state";
import { PresetsScreen } from "../../src/ui/screens/presets";
import { DEFAULT_THEME, TOKYO_NIGHT } from "../../src/ui/themes";

const setups: { renderer: { destroy: () => void } }[] = [];
afterEach(async () => {
	for (const s of setups.splice(0)) {
		await act(async () => {
			s.renderer.destroy();
		});
	}
});

const FILE: PresetFile = {
	version: 2,
	presets: [
		{
			id: "p1",
			name: "Qwen 32B",
			model_path: "~/models/qwen.gguf",
			flags: {},
			env_vars: {},
			created_at: "2026-08-24T00:00:00Z",
			last_used: null,
		},
	],
};
const PATHS = new Set(["~/models/qwen.gguf"]);

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

async function pressEscape(
	setup: Awaited<ReturnType<typeof testRender>>,
): Promise<void> {
	await act(async () => {
		await setup.mockInput.pressKeys(["\x1b"]);
	});
	await act(async () => {
		await new Promise((r) => setTimeout(r, 120));
		await setup.flush();
	});
}

describe("presets rename + load&launch bindings (Tier 3)", () => {
	it("n requests a rename for the selected preset; L loads+launches", async () => {
		const renameRequests: Preset[] = [];
		const loadAndLaunch: Preset[] = [];
		const setup = await testRender(
			<PresetsScreen
				theme={TOKYO_NIGHT}
				file={FILE}
				existingModelPaths={PATHS}
				focused
				onRequestRename={(p) => {
					renameRequests.push(p);
				}}
				onLoadAndLaunch={(p) => {
					loadAndLaunch.push(p);
				}}
			/>,
			{ width: 110, height: 22 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		await press(setup, ["n"]);
		expect(renameRequests.map((p) => p.id)).toEqual(["p1"]);
		await press(setup, ["L"]);
		expect(loadAndLaunch.map((p) => p.id)).toEqual(["p1"]);
	});

	it("footer documents the new bindings", async () => {
		const setup = await testRender(
			<PresetsScreen
				theme={TOKYO_NIGHT}
				file={FILE}
				existingModelPaths={PATHS}
				focused
			/>,
			{ width: 130, height: 22 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		const frame = setup.captureCharFrame();
		expect(frame).toContain("[n] Rename");
		expect(frame).toContain("[L] Load+Launch");
	});
});

describe("rename modal in the shell (Tier 3)", () => {
	async function renderApp(
		handlers: {
			onRename?: (id: string, name: string) => void;
			onLoadAndLaunch?: (p: Preset) => void;
		} = {},
	) {
		const setup = await testRender(
			<App
				theme={DEFAULT_THEME}
				presetsControl={{
					file: FILE,
					existingModelPaths: PATHS,
					onRename: handlers.onRename,
					onLoadAndLaunch: handlers.onLoadAndLaunch,
				}}
				configuratorControl={{
					state: createConfigurator(null),
					setState: () => {},
				}}
			/>,
			{ width: 110, height: 30 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		await press(setup, ["4"]);
		return setup;
	}

	it("n opens the modal prefilled; Enter renames; digits stay in the field", async () => {
		const renamed: [string, string][] = [];
		const setup = await renderApp({
			onRename: (id, name) => {
				renamed.push([id, name]);
			},
		});
		await press(setup, ["n"]);
		let frame = setup.captureCharFrame();
		expect(frame).toContain("Rename preset");
		expect(frame).toContain("Qwen 32B");
		// Typing (incl. a digit) edits the name — it must NOT switch tabs
		// while the modal owns the keyboard.
		await press(setup, [" ", "v", "2"]);
		frame = setup.captureCharFrame();
		expect(frame).toContain("Rename preset");
		await press(setup, ["\r"]);
		expect(renamed).toEqual([["p1", "Qwen 32B v2"]]);
		expect(setup.captureCharFrame()).not.toContain("Rename preset");
	});

	it("Esc cancels without renaming", async () => {
		const renamed: [string, string][] = [];
		const setup = await renderApp({
			onRename: (id, name) => {
				renamed.push([id, name]);
			},
		});
		await press(setup, ["n"]);
		expect(setup.captureCharFrame()).toContain("Rename preset");
		await pressEscape(setup);
		expect(renamed).toEqual([]);
		expect(setup.captureCharFrame()).not.toContain("Rename preset");
	});

	it("L loads+launches and lands on Launch Config", async () => {
		const launched: string[] = [];
		const setup = await renderApp({
			onLoadAndLaunch: (p) => {
				launched.push(p.id);
			},
		});
		await press(setup, ["L"]);
		expect(launched).toEqual(["p1"]);
		expect(setup.captureCharFrame()).toContain("Launch config");
	});
});
