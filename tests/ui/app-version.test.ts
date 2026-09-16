import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import pkg from "../../package.json";
import { APP_VERSION } from "../../src/ui/constants";

describe("shell header version single-sourcing (#35)", () => {
	it("APP_VERSION comes from package.json", () => {
		expect(APP_VERSION).toBe(pkg.version);
	});

	it("golden header frames render the packaged version, not a stale literal", () => {
		const header = `llama-deck v${APP_VERSION}`;
		for (const frame of [
			"tests/ui/golden/app-header-120x40.framesnap",
			"tests/ui/golden/app-header-200x60.framesnap",
		]) {
			expect(readFileSync(frame, "utf8")).toContain(header);
		}
	});
});
