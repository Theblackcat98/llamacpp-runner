import { describe, expect, it } from "bun:test";
import {
	createConfigurator,
	loadPresetInto,
	vramRangeBytes,
	vramRangeText,
} from "../../src/ui/logic/configurator-state";
import { isConfiguratorTextField } from "../../src/ui/screens/configurator";

describe("configurator text field contract (P2)", () => {
	it("identifies text input fields correctly without magic index coupling", () => {
		// Non-text fields: sliders, checkboxes, selects (0 to 11)
		for (let i = 0; i <= 11; i++) {
			expect(isConfiguratorTextField(i)).toBe(false);
		}
		// Text input fields: host, port, alias, chat-template (12 to 15)
		expect(isConfiguratorTextField(12)).toBe(true);
		expect(isConfiguratorTextField(13)).toBe(true);
		expect(isConfiguratorTextField(14)).toBe(true);
		expect(isConfiguratorTextField(15)).toBe(true);
		// Beyond field count
		expect(isConfiguratorTextField(16)).toBe(false);
	});
});

describe("silent zero VRAM estimate handling (P3)", () => {
	it("returns null range and surfaces missing estimate text when model fileSize is 0", () => {
		const base = createConfigurator({
			path: "/models/valid.gguf",
			blockCount: 32,
			contextLength: 4096,
			fileSize: 10_000_000_000,
			headCount: 32,
			headCountKv: 8,
			embeddingLength: 4096,
		});

		// Valid model has range and text
		expect(vramRangeBytes(base)).not.toBeNull();
		expect(vramRangeText(base)).toContain("estimated range");

		// Load preset with absent model -> fileSize: 0
		const presetLoaded = loadPresetInto(
			createConfigurator(null),
			{},
			"/missing/model.gguf",
		);
		expect(presetLoaded.model?.fileSize).toBe(0);

		// Must return null bytes and honest guidance
		expect(vramRangeBytes(presetLoaded)).toBeNull();
		expect(vramRangeText(presetLoaded)).toBe(
			"model missing — estimate unavailable",
		);
	});
});
