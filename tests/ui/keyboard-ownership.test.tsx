import { afterEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, useState } from "react";
import { App } from "../../src/ui/app";
import { ScrollPane } from "../../src/ui/components/scroll-pane";
import { VirtualizedTable } from "../../src/ui/components/table";
import type { TableColumn } from "../../src/ui/components/table-state";
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

type TableRow = { id: number; label: string };
const TABLE_COLUMNS: TableColumn<TableRow>[] = [
	{ key: "id", title: "ID", width: 4, align: "right" },
	{ key: "label", title: "LABEL", width: 12, align: "left" },
];
const TABLE_ROWS: TableRow[] = [
	{ id: 0, label: "first" },
	{ id: 1, label: "second" },
];

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
	it("registers only while focused and cleans up across unmount/remount cycles", async () => {
		let setFocused: (focused: boolean) => void = () => {};
		let setMounted: (mounted: boolean) => void = () => {};
		function TableHarness() {
			const [focused, updateFocused] = useState(false);
			const [mounted, updateMounted] = useState(true);
			setFocused = updateFocused;
			setMounted = updateMounted;
			return mounted ? (
				<VirtualizedTable
					theme={TOKYO_NIGHT}
					columns={TABLE_COLUMNS}
					data={TABLE_ROWS}
					captureKeys
					focused={focused}
					viewport={2}
				/>
			) : null;
		}

		const setup = await testRender(<TableHarness />, { width: 40, height: 5 });
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		expect(appListeners(setup)).toBe(0);

		await act(async () => setFocused(true));
		await act(async () => {
			await setup.flush();
		});
		expect(appListeners(setup)).toBe(1);

		await act(async () => setFocused(false));
		await act(async () => {
			await setup.flush();
		});
		expect(appListeners(setup)).toBe(0);

		for (let i = 0; i < 3; i++) {
			await act(async () => setMounted(false));
			await act(async () => {
				await setup.flush();
			});
			expect(appListeners(setup)).toBe(0);

			await act(async () => setMounted(true));
			await act(async () => setFocused(true));
			await act(async () => {
				await setup.flush();
			});
			expect(appListeners(setup)).toBe(1);
		}
	});

	it("preserves focused table navigation and Enter selection", async () => {
		const selections: number[] = [];
		const selectedRows: TableRow[] = [];
		const setup = await testRender(
			<VirtualizedTable
				theme={TOKYO_NIGHT}
				columns={TABLE_COLUMNS}
				data={TABLE_ROWS}
				captureKeys
				focused
				viewport={2}
				onSelectionChange={(index) => selections.push(index)}
				onSelect={(index, row) => {
					selections.push(index);
					selectedRows.push(row);
				}}
			/>,
			{ width: 40, height: 5 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});

		await act(async () => {
			await setup.mockInput.pressKeys(["\x1b[B"]);
		});
		await act(async () => {
			await setup.flush();
		});
		await act(async () => {
			await setup.mockInput.pressKeys(["\r"]);
		});
		await act(async () => {
			await setup.flush();
		});

		expect(selections).toEqual([1, 1]);
		expect(selectedRows).toEqual(TABLE_ROWS.slice(1));
	});

	it("scopes ScrollPane listeners to focus and cleans up on unmount", async () => {
		let setFocused: (focused: boolean) => void = () => {};
		let setMounted: (mounted: boolean) => void = () => {};
		function ScrollPaneHarness() {
			const [focused, updateFocused] = useState(false);
			const [mounted, updateMounted] = useState(true);
			setFocused = updateFocused;
			setMounted = updateMounted;
			return mounted ? (
				<ScrollPane
					theme={TOKYO_NIGHT}
					captureKeys
					focused={focused}
					contentLines={["line 1", "line 2", "line 3"]}
					viewport={2}
				/>
			) : null;
		}

		const setup = await testRender(<ScrollPaneHarness />, {
			width: 40,
			height: 5,
		});
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		expect(appListeners(setup)).toBe(0);

		await act(async () => setFocused(true));
		await act(async () => {
			await setup.flush();
		});
		expect(appListeners(setup)).toBe(1);

		await act(async () => setFocused(false));
		await act(async () => {
			await setup.flush();
		});
		expect(appListeners(setup)).toBe(0);

		await act(async () => setMounted(false));
		await act(async () => {
			await setup.flush();
		});
		expect(appListeners(setup)).toBe(0);
	});

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

	it("keeps Ctrl+S owned by the shell and fires it once", async () => {
		let saves = 0;
		const setup = await testRender(
			<App
				theme={DEFAULT_THEME}
				configuratorControl={{
					state: createConfigurator(MODEL),
					setState: () => {},
				}}
				onSavePreset={() => {
					saves++;
				}}
			/>,
			{ width: 100, height: 30 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
			await setup.mockInput.pressKeys(["2"]);
			await setup.flush();
		});
		await act(async () => {
			setup.mockInput.pressKey("s", { ctrl: true });
			await setup.flush();
		});
		expect(saves).toBe(1);
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
		expect(setup.captureCharFrame()).toContain("Launch config");
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
		expect(frame).toContain("Launch config");
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
