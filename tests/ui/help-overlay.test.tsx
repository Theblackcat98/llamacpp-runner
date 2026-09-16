import { afterEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { App } from "../../src/ui/app";
import {
	dimHex,
	HelpOverlay,
	overlayGeometry,
} from "../../src/ui/components/help-overlay";
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
 * F15: `?` opens a binding legend so tab-conditional keys (m/r/c/d/l/t/y)
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
			["Model Explorer", ["[m]", "[r]"]],
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

	it("stays fully visible at 80x24 (clamped, centered)", async () => {
		const setup = await testRender(
			<HelpOverlay theme={TOKYO_NIGHT} open tabName="Presets" />,
			{ width: 80, height: 24 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		const frame = setup.captureCharFrame();
		// Presets has the most tab rows (6); all bindings must survive
		// clamping — nothing clipped off-screen.
		for (const key of ["[c]", "[d]", "[l]", "[r]", "[i]", "[x]", "[?]"])
			expect(frame).toContain(key);
		// Panel border reads as centered: first border row has margins.
		const lines = frame.split("\n");
		const border = lines.find((l) => l.includes("Keyboard shortcuts"));
		expect(border).toBeDefined();
		if (border === undefined) throw new Error("help title row missing");
		const corner = Math.max(border.indexOf("╭"), border.indexOf("┌"));
		expect(corner).toBeGreaterThan(0);
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
		expect(setup.captureCharFrame()).not.toContain("shortcuts");
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
		expect(setup.captureCharFrame()).not.toContain("shortcuts");

		await act(async () => {
			await setup.mockInput.pressKeys(["?"]);
		});
		await act(async () => {
			await setup.flush();
		});
		expect(setup.captureCharFrame()).toContain("shortcuts");

		await act(async () => {
			await setup.mockInput.pressKeys(["?"]);
		});
		await act(async () => {
			await setup.flush();
		});
		expect(setup.captureCharFrame()).not.toContain("shortcuts");
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

describe("help overlay geometry (#53)", () => {
	it("centers the panel on a roomy terminal", () => {
		// Launch Config: 10 global + 7 tab rows + 7 chrome = 24 rows.
		expect(overlayGeometry(100, 30, 76, 24)).toEqual({
			left: 12,
			top: 3,
			width: 76,
			height: 24,
		});
	});

	it("clamps to the terminal at 80x24 and stays fully visible", () => {
		// Presets: 10 + 6 + 7 = 23 rows — fits 80x24 with side margins.
		const g = overlayGeometry(80, 24, 76, 23);
		expect(g.width).toBe(76);
		expect(g.height).toBe(23);
		expect(g.left).toBe(2);
		expect(g.top).toBe(0);
		expect(g.left + g.width).toBeLessThanOrEqual(80);
		expect(g.top + g.height).toBeLessThanOrEqual(24);
	});

	it("never produces negative origins on tiny terminals", () => {
		expect(overlayGeometry(40, 10, 76, 23)).toEqual({
			left: 0,
			top: 0,
			width: 40,
			height: 10,
		});
	});
});

describe("backdrop dimming (#53)", () => {
	it("darkens a hex color by the given factor", () => {
		expect(dimHex("#ffffff", 0.5)).toBe("#808080");
		expect(dimHex("#1a1b26", 0.55)).toBe("#0e0f15");
		expect(dimHex("#000000", 0.5)).toBe("#000000");
	});
});
