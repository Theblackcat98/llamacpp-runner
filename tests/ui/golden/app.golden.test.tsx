import { describe, it } from "bun:test";
import { App } from "../../../src/ui/app";
import { TOKYO_NIGHT } from "../../../src/ui/themes";
import { expectGoldenFrame } from "./harness";

const explorerControl = {
	entries: [],
	scanning: false,
	modelsDir: null,
	onRescan: () => {},
};

const app = <App theme={TOKYO_NIGHT} explorerControl={explorerControl} />;

const openHelp = async (
	setup: Awaited<
		ReturnType<typeof import("@opentui/react/test-utils").testRender>
	>,
) => {
	await setup.mockInput.pressKeys(["?"]);
};

describe("app-composed shell golden frames (issue #30)", () => {
	it("renders the complete header at 120x40", async () => {
		await expectGoldenFrame("app-header-120x40", app, {
			width: 120,
			height: 40,
		});
	});

	it("renders the complete header at 200x60", async () => {
		await expectGoldenFrame("app-header-200x60", app, {
			width: 200,
			height: 60,
		});
	});

	it("fully occludes first-run content at 120x40", async () => {
		await expectGoldenFrame("app-help-overlay-120x40", app, {
			width: 120,
			height: 40,
			beforeCapture: openHelp,
		});
	});

	it("fully occludes first-run content and shows Explorer help at 200x60", async () => {
		await expectGoldenFrame("app-help-overlay-200x60", app, {
			width: 200,
			height: 60,
			beforeCapture: openHelp,
		});
	});
});
