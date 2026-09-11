import { describe, it } from "bun:test";
import { Palette } from "../../../src/ui/components/palette";
import { buildDefaultActions } from "../../../src/ui/logic/action-registry";
import { createPaletteState } from "../../../src/ui/logic/palette-state";
import { DEFAULT_THEME } from "../../../src/ui/themes";
import { expectGoldenFrame } from "./harness";

const actions = buildDefaultActions({
	switchTheme: () => {},
	setPort: () => {},
	killServer: () => {},
	exportCommand: () => {},
	rescanModels: () => {},
	toggleTelemetry: () => {},
	goToTab: () => {},
	clearLog: () => {},
});

describe("palette golden frames", () => {
	it("open palette with empty query shows full registry", async () => {
		await expectGoldenFrame(
			"palette-open",
			<Palette
				theme={DEFAULT_THEME}
				state={createPaletteState({ open: true })}
				actions={actions}
			/>,
			{ width: 100, height: 20 },
		);
	});

	it("closed palette renders nothing", async () => {
		await expectGoldenFrame(
			"palette-closed",
			<Palette
				theme={DEFAULT_THEME}
				state={createPaletteState()}
				actions={actions}
			/>,
			{ width: 100, height: 20 },
		);
	});
});
