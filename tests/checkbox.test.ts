import { describe, expect, it } from "bun:test";
import {
	createCheckboxState,
	toggle,
} from "../src/ui/components/checkbox-state";

describe("checkbox state (P2-FR-03)", () => {
	it("starts unchecked and toggles via space", () => {
		const s = createCheckboxState();
		expect(s.checked).toBe(false);
		expect(toggle(s).checked).toBe(true);
		expect(toggle(toggle(s)).checked).toBe(false);
	});
});
