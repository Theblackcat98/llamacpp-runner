import { describe, expect, it } from "bun:test";
import { toTitleCase } from "../../src/ui/title-case";

describe("toTitleCase (#47)", () => {
	it("sentence-cases ALL-CAPS titles", () => {
		expect(toTitleCase("QUICK LAUNCH COMMAND PREVIEW")).toBe(
			"Quick launch command preview",
		);
		expect(toTitleCase("WELCOME")).toBe("Welcome");
		expect(toTitleCase("SET MODELS DIRECTORY")).toBe("Set models directory");
	});

	it("handles leading non-letters", () => {
		expect(toTitleCase("─ CONSOLE")).toBe("─ Console");
	});

	it("leaves mixed-case and lowercase titles alone", () => {
		expect(toTitleCase("Container Borders")).toBe("Container Borders");
		expect(toTitleCase("llama-deck")).toBe("llama-deck");
		expect(toTitleCase("Failure (§6.4)")).toBe("Failure (§6.4)");
	});

	it("handles empty strings", () => {
		expect(toTitleCase("")).toBe("");
	});
});
