import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Catalog } from "../../../src/ui/screens/catalog";
import {
	DEFAULT_THEME,
	THEMES,
	type Theme,
	TOKYO_NIGHT,
} from "../../../src/ui/themes";
import {
	expectGoldenFrame,
	expectGoldenSpans,
	renderWithAct,
	teardownWithAct,
} from "./harness";

const GOLDEN_DIR = import.meta.dir;

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

	it("matches golden frames in all seven themes", async () => {
		for (const theme of THEMES) {
			await expectGoldenFrame(
				`catalog-${theme.name.toLowerCase()}`,
				<Catalog theme={theme} />,
				{ width: 100, height: 30 },
			);
		}
	});
});

describe("theme-distinct catalog goldens (#21)", () => {
	it("captures color-aware span goldens for every theme", async () => {
		for (const theme of THEMES) {
			await expectGoldenSpans(
				`catalog-${theme.name.toLowerCase()}`,
				<Catalog theme={theme} />,
				{ width: 100, height: 30 },
			);
		}
	});

	it("theme span goldens are pairwise distinct — no copied snapshots", () => {
		const hashes = new Set<string>();
		for (const theme of THEMES) {
			const file = join(
				GOLDEN_DIR,
				`catalog-${theme.name.toLowerCase()}.spansnap`,
			);
			const hash = createHash("sha256")
				.update(readFileSync(file))
				.digest("hex");
			expect(hashes.has(hash)).toBe(false);
			hashes.add(hash);
		}
		expect(hashes.size).toBe(THEMES.length);
	});

	it("mutating a theme token breaks the committed golden (#21)", async () => {
		// Skip during golden regeneration: UPDATE_GOLDEN would (a) rewrite
		// the committed snapshot from the mutant and (b) make the comparison
		// vacuous. This guard only runs in verify mode.
		if (process.env.UPDATE_GOLDEN === "1") return;
		const mutant: Theme = { ...TOKYO_NIGHT, bg: "#ff0000" };
		await expect(
			expectGoldenSpans("catalog-tokyonight", <Catalog theme={mutant} />, {
				width: 100,
				height: 30,
			}),
		).rejects.toThrow();
	});
});
