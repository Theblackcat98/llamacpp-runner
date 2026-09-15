import { afterEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { App } from "../../src/ui/app";
import { HelpOverlay } from "../../src/ui/components/help-overlay";
import { DEFAULT_THEME, TOKYO_NIGHT } from "../../src/ui/themes";

const setups: { renderer: { destroy: () => void } }[] = [];
afterEach(async () => {
	for (const s of setups.splice(0)) {
		(
			globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		await act(async () => {
			s.renderer.destroy();
		});
	}
});

/**
 * F15: `?` opens a binding legend so tab-conditional keys (s/r/c/d/l/t/y)
 * are discoverable without reading the source.
 */
describe("help overlay content (F15)", () => {
	it("lists global bindings on every tab", async () => {
		const setup = await testRender(
			<HelpOverlay theme={TOKYO_NIGHT} open tabName="Presets" />,
			{ width: 100, height: 24 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		const frame = setup.captureCharFrame();
		for (const key of [
			"[x]",
			"[k]",
			"[o]",
			"[Tab]",
			"[1-4]",
			"[q]",
			"[?]",
			"Ctrl+P",
			"Ctrl+L",
		])
			expect(frame).toContain(key);
	});

	it("shows the current tab's bindings", async () => {
		const cases: [string, string[]][] = [
			["Model Explorer", ["[s]", "[r]"]],
			["Launch Config", ["[y]", "Ctrl+S", "Ctrl+Y"]],
			["Server Telemetry", ["[t]"]],
			["Presets", ["[c]", "[d]", "[l]", "[r]"]],
		];
		for (const [tabName, keys] of cases) {
			const setup = await testRender(
				<HelpOverlay theme={TOKYO_NIGHT} open tabName={tabName} />,
				{ width: 100, height: 24 },
			);
			setups.push(setup);
			await act(async () => {
				await setup.flush();
			});
			const frame = setup.captureCharFrame();
			for (const key of keys) expect(frame).toContain(key);
		}
	});

	it("renders nothing when closed", async () => {
		const setup = await testRender(
			<HelpOverlay theme={TOKYO_NIGHT} open={false} tabName="Presets" />,
			{ width: 100, height: 24 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		expect(setup.captureCharFrame()).not.toContain("SHORTCUTS");
	});
});

describe("help overlay toggle (F15)", () => {
	it("? opens and closes the legend", async () => {
		const setup = await testRender(<App theme={DEFAULT_THEME} />, {
			width: 100,
			height: 30,
		});
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		expect(setup.captureCharFrame()).not.toContain("SHORTCUTS");

		await act(async () => {
			await setup.mockInput.pressKeys(["?"]);
		});
		await act(async () => {
			await setup.flush();
		});
		expect(setup.captureCharFrame()).toContain("SHORTCUTS");

		await act(async () => {
			await setup.mockInput.pressKeys(["?"]);
		});
		await act(async () => {
			await setup.flush();
		});
		expect(setup.captureCharFrame()).not.toContain("SHORTCUTS");
	});

	it("footer advertises the legend", async () => {
		const setup = await testRender(<App theme={DEFAULT_THEME} />, {
			width: 100,
			height: 30,
		});
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		expect(setup.captureCharFrame()).toContain("[?]");
	});
});
