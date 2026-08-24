import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { Catalog } from "../../../src/ui/screens/catalog";
import { DEFAULT_THEME, THEMES } from "../../../src/ui/themes";
import { expectGoldenFrame } from "./harness";

describe("components catalog (P2-FR-15, §9 EXIT)", () => {
	it("renders every catalog section", async () => {
		const setup = await testRender(<Catalog theme={DEFAULT_THEME} />, {
			width: 100,
			height: 30,
		});
		try {
			await setup.flush();
			const frame = setup.captureCharFrame();
			expect(frame).toContain("Container Borders");
			expect(frame).toContain("Typography");
			expect(frame).toContain("Data Table");
			expect(frame).toContain("File Tree");
		} finally {
			setup.renderer.destroy();
		}
	});

	it("matches golden frames in all five themes", async () => {
		for (const theme of THEMES) {
			await expectGoldenFrame(
				`catalog-${theme.name.toLowerCase()}`,
				<Catalog theme={theme} />,
				{ width: 100, height: 30 },
			);
		}
	});
});
