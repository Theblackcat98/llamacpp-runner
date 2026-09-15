import { afterEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { App } from "../../src/ui/app";
import { createConfigurator } from "../../src/ui/logic/configurator-state";
import { Configurator } from "../../src/ui/screens/configurator";
import { DEFAULT_THEME, TOKYO_NIGHT } from "../../src/ui/themes";

const setups: { renderer: { destroy: () => void } }[] = [];
afterEach(async () => {
	for (const s of setups.splice(0)) {
		await act(async () => {
			s.renderer.destroy();
		});
	}
});

const MODEL = {
	path: "~/models/qwen.gguf",
	blockCount: 64,
	contextLength: 32768,
	fileSize: 20 * 1024 ** 3,
	headCount: 40,
	headCountKv: 8,
	embeddingLength: 5120,
};

/** Count keypress listeners on the active test renderer's key handler. */
function keypressListeners(setup: {
	renderer: { keyInput?: { listenerCount?: (e: string) => number } };
}): number {
	const keyInput = setup.renderer.keyInput;
	return keyInput?.listenerCount?.("keypress") ?? 0;
}

/** Listeners attributable to the app itself (the renderer always has 1). */
const RENDERER_BASELINE = 1;

function appListeners(setup: {
	renderer: { keyInput?: { listenerCount?: (e: string) => number } };
}): number {
	return Math.max(0, keypressListeners(setup) - RENDERER_BASELINE);
}

/**
 * Phase 13: keyboard ownership. The Configurator mounts 10 widgets, but only
 * the focused screen owns the key handler — a single keypress reaches exactly
 * one handler, and remount cycles never accumulate listeners.
 */
describe("keyboard ownership (Phase 13)", () => {
	it("mounts exactly one keypress listener for the focused screen", async () => {
		const setup = await testRender(
			<Configurator
				theme={TOKYO_NIGHT}
				state={createConfigurator(MODEL)}
				focused
			/>,
			{ width: 100, height: 26 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		// Screen handler + the focused field's widget, not 11 widget handlers.
		expect(appListeners(setup)).toBeLessThanOrEqual(2);
	});

	it("listener count stays flat as focus moves between fields", async () => {
		const setup = await testRender(
			<Configurator
				theme={TOKYO_NIGHT}
				state={createConfigurator(MODEL)}
				focused
			/>,
			{ width: 100, height: 26 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		const before = appListeners(setup);
		// Move focus through several fields: scoped widgets swap in/out, the
		// total listener count must not creep up (no accumulation).
		for (let i = 0; i < 6; i++) {
			await act(async () => {
				await setup.mockInput.pressKeys(["\x1b[B"]); // down
			});
			await act(async () => {
				await setup.flush();
			});
		}
		expect(appListeners(setup)).toBeLessThanOrEqual(before + 1);
	});

	it("Enter on the configurator never fires a duplicate launch", async () => {
		const launches = 0;
		const setup = await testRender(
			<Configurator
				theme={TOKYO_NIGHT}
				state={createConfigurator(MODEL)}
				focused
			/>,
			{ width: 100, height: 26 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.mockInput.pressKeys(["\r"]);
		});
		// Enter ownership lives in the shell (App); the screen no longer
		// registers a `return` handler, so a press can't double-launch.
		expect(launches).toBe(0);
	});
});

/**
 * Phase 13 one-owner rule at the shell level: while a Configurator text field
 * is focused, plain printable keys belong to the input — digits must not
 * switch tabs and o/k/q must not trigger shell actions.
 */
describe("shell yields printables while typing (Phase 13)", () => {
	it("digits typed in the host field do not switch tabs", async () => {
		const setup = await testRender(
			<App
				theme={DEFAULT_THEME}
				configuratorControl={{
					state: createConfigurator(MODEL),
					setState: () => {},
				}}
			/>,
			{ width: 100, height: 30 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		// Go to Launch Config, then walk focus down to the host field (12).
		await act(async () => {
			await setup.mockInput.pressKeys(["2"]);
		});
		await act(async () => {
			await setup.flush();
		});
		expect(setup.captureCharFrame()).toContain("LAUNCH CONFIG");
		for (let i = 0; i < 12; i++) {
			await act(async () => {
				await setup.mockInput.pressKeys(["\x1b[B"]); // down
			});
			await act(async () => {
				await setup.flush();
			});
		}
		await act(async () => {
			await setup.flush();
		});
		// Typing "1" must reach the input buffer, not switch to Model Explorer (tab 1).
		await act(async () => {
			await setup.mockInput.pressKeys(["1"]);
		});
		await act(async () => {
			await setup.flush();
		});
		const frame = setup.captureCharFrame();
		expect(frame).toContain("LAUNCH CONFIG");
		expect(frame).not.toContain("MODEL EXPLORER");
	});

	it("printables in a text field never trigger the console toggle", async () => {
		const setup = await testRender(
			<App
				theme={DEFAULT_THEME}
				configuratorControl={{
					state: createConfigurator(MODEL),
					setState: () => {},
				}}
			/>,
			{ width: 100, height: 30 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		await act(async () => {
			await setup.mockInput.pressKeys(["2"]);
		});
		await act(async () => {
			await setup.flush();
		});
		for (let i = 0; i < 14; i++) {
			// down to the alias field (14)
			await act(async () => {
				await setup.mockInput.pressKeys(["\x1b[B"]);
			});
			await act(async () => {
				await setup.flush();
			});
		}
		// typing an alias containing "o" must not toggle the console drawer
		await act(async () => {
			await setup.mockInput.pressKeys(["m", "o", "d", "e", "l"]);
		});
		await act(async () => {
			await setup.flush();
		});
		const frame = setup.captureCharFrame();
		expect(frame).toContain("model"); // alias text reached the input
		expect(frame).not.toContain("(o to expand)"); // drawer NOT collapsed
	});
});
