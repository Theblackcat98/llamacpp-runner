import { describe, expect, it } from "bun:test";
import { App } from "../../src/ui/app";
import { APP_VERSION } from "../../src/ui/constants";
import { TOKYO_NIGHT } from "../../src/ui/themes";
import { renderWithAct, teardownWithAct } from "./golden/harness";

const explorerControl = {
	entries: [],
	scanning: false,
	modelsDir: null,
	onRescan: () => {},
};

describe("shell header de-chroming (#43)", () => {
	it("renders a 1-line borderless header with name, version, and status", async () => {
		const setup = await renderWithAct(
			<App theme={TOKYO_NIGHT} explorerControl={explorerControl} />,
			{ width: 120, height: 40 },
		);
		const frame = setup.captureCharFrame();
		await teardownWithAct(setup);
		const rows = frame.split("\n");

		// Header is exactly the first row: name + version + status, no box.
		expect(rows[0]).toContain(`llama-deck v${APP_VERSION}`);
		expect(rows[0]).toContain("idle");
		expect(rows[0]).not.toMatch(/[┌┐└┘─│╔╗╚╝═║╭╮╰╯]/);
		// The tab bar starts immediately on the next row — no border rows
		// between header and tabs.
		expect(rows[1]).toContain("[1] Model Explorer");
	});

	it("shows the server-running status on the header line when live", async () => {
		const setup = await renderWithAct(
			<App
				theme={TOKYO_NIGHT}
				explorerControl={explorerControl}
				serverRunning
			/>,
			{ width: 120, height: 40 },
		);
		const frame = setup.captureCharFrame();
		await teardownWithAct(setup);
		expect(frame.split("\n")[0]).toContain("server running");
	});
});
