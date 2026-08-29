import { describe, expect, it } from "bun:test";
import { Catalog } from "../../../src/ui/screens/catalog";
import { DEFAULT_THEME, THEMES } from "../../../src/ui/themes";
import { expectGoldenFrame, renderWithAct, teardownWithAct } from "./harness";

describe("components catalog (P2-FR-15, §9 EXIT)", () => {
	it("renders every catalog section", async () => {
		const setup = await renderWithAct(<Catalog theme={DEFAULT_THEME} />, {
			width: 100,
			height: 30,
		});
		try {
			const frame = setup.captureCharFrame();
			expect(frame).toContain("Container Borders");
			expect(frame).toContain("Typography");
			expect(frame).toContain("Data Table");
			expect(frame).toContain("File Tree");
		} finally {
			await teardownWithAct(setup);
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
