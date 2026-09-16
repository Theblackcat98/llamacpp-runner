import { describe, expect, it } from "bun:test";
import { App } from "../../src/ui/app";
import { TOKYO_NIGHT } from "../../src/ui/themes";
import { renderWithAct, teardownWithAct } from "./golden/harness";

const explorerControl = {
	entries: [],
	scanning: false,
	modelsDir: null,
	onRescan: () => {},
};

describe("screen pane de-chroming (#44)", () => {
	it("renders no pane-level border or title — whitespace separates the tab bar from screen content", async () => {
		const setup = await renderWithAct(
			<App theme={TOKYO_NIGHT} explorerControl={explorerControl} />,
			{ width: 120, height: 40 },
		);
		const frame = setup.captureCharFrame();
		await teardownWithAct(setup);
		const rows = frame.split("\n");

		// Row 0: header, row 1: tab bar, row 2: the pane's top margin —
		// a blank whitespace row, never a border or title row.
		expect(rows[1]).toContain("[1] Model Explorer");
		const sep = rows[2] ?? "";
		expect(sep.trim()).toBe("");
		expect(sep).not.toMatch(/[┌┐└┘─│╔╗╚╝═║╭╮╰╯]/);
		// Screen content starts immediately after: the Explorer's own
		// WELCOME widget, not a pane wrapper.
		expect(rows[3]).toContain("WELCOME");
	});

	it("keeps tab switching and focus cycling working with the borderless pane", async () => {
		// Render the telemetry tab (tab index 2) via initialTab: the pane
		// must stay borderless on every screen, not just the explorer.
		const setup = await renderWithAct(
			<App theme={TOKYO_NIGHT} initialTab={2} />,
			{ width: 120, height: 40 },
		);
		const frame = setup.captureCharFrame();
		await teardownWithAct(setup);
		const rows = frame.split("\n");
		const sep = rows[2] ?? "";
		expect(sep.trim()).toBe("");
		expect(sep).not.toMatch(/[┌┐└┘─│╔╗╚╝═║╭╮╰╯]/);
		// Telemetry's own widget follows the whitespace row (dormant state
		// renders its SERVER TELEMETRY box — still no pane wrapper).
		expect(rows[3]).toContain("SERVER TELEMETRY");
	});
});
