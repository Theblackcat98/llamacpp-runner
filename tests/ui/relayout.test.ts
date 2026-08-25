import { describe, expect, it } from "bun:test";
import {
	beginResize,
	createRelayout,
	type RelayoutState,
	settleDue,
} from "../../src/ui/logic/layout-state";

describe("resize-churn debounce (P5-FR-14)", () => {
	const MS = 120;

	it("initial dimensions commit immediately", () => {
		const s0 = createRelayout(80, 24);
		expect(s0.committed).toEqual({ width: 80, height: 24 });
	});

	it("churn events never commit until quiet period elapses", () => {
		let s: RelayoutState = createRelayout(100, 30);
		s = beginResize(s, { width: 101, height: 30 }, 0);
		s = beginResize(s, { width: 102, height: 30 }, 40);
		s = beginResize(s, { width: 103, height: 31 }, 80);
		// all intermediate settles are no-ops while churn continues
		expect(settleDue(s, 90, MS).dims).toBeNull();
		expect(settleDue(s, 119, MS).dims).toBeNull();
		const r = settleDue(s, 200, MS); // 80 + 120
		expect(r.dims).toEqual({ width: 103, height: 31 });
		expect(r.state.committed).toEqual({ width: 103, height: 31 });
		expect(r.state.pending).toBeNull();
	});

	it("newer event during wait replaces older pending", () => {
		let s: RelayoutState = createRelayout(100, 30);
		s = beginResize(s, { width: 110, height: 30 }, 0);
		s = beginResize(s, { width: 120, height: 40 }, 50);
		const r = settleDue(s, 170, MS);
		expect(r.dims).toEqual({ width: 120, height: 40 });
	});

	it("settling with nothing pending yields null", () => {
		const s = createRelayout(100, 30);
		expect(settleDue(s, 9999, MS).dims).toBeNull();
	});
});
