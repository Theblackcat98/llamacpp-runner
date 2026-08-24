import { describe, expect, it } from "bun:test";
import {
	createFocusEngine,
	cycleFocus,
	type FocusEngine,
	routeKey,
	setInputCapture,
} from "../src/ui/focus/engine";

describe("focus engine (P2-FR-13)", () => {
	it("registers panes and starts on the first", () => {
		const e = createFocusEngine(["table", "form", "drawer"]);
		expect(e.order).toEqual(["table", "form", "drawer"]);
		expect(e.current).toBe("table");
	});

	it("Tab cycles forward with wraparound; Shift+Tab backward", () => {
		let e = createFocusEngine(["a", "b", "c"]);
		e = cycleFocus(e, false);
		expect(e.current).toBe("b");
		e = cycleFocus(e, true);
		expect(e.current).toBe("a");
		e = cycleFocus(e, true);
		expect(e.current).toBe("c");
	});

	it("input-mode capture routes keys to the focused input only", () => {
		const e: FocusEngine = setInputCapture(
			createFocusEngine(["input", "table"]),
			true,
		);
		let capturedKey: string | undefined;
		const routed = routeKey(
			e,
			{ name: "j" },
			{
				onCapture: (k) => (capturedKey = k.name),
			},
		);
		expect(routed.captured).toBe(true);
		expect(routed.global).toBe(false);
		expect(capturedKey).toBe("j");
	});

	it("typing j while captured does not reach global handlers", () => {
		const e: FocusEngine = setInputCapture(
			createFocusEngine(["input", "table"]),
			true,
		);
		const seen: string[] = [];
		routeKey(e, { name: "j" }, { onGlobal: (k) => seen.push(k.name ?? "") });
		expect(seen).toEqual([]);
	});

	it("normal mode passes keys to global routing and focus events fire", () => {
		let e: FocusEngine = createFocusEngine(["input", "table"]);
		const events: [string | undefined, string][] = [];
		e = {
			...e,
			onFocusChange: (from, to) => {
				if (from !== undefined) events.push([from, to]);
			},
		};
		const before = e.current;
		e = cycleFocus(e, false);
		expect(events).toEqual([[before, e.current]]);
	});
});
