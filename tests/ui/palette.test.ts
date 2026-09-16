import { describe, expect, it } from "bun:test";
import {
	buildDefaultActions,
	PALETTE_ACTION_IDS,
} from "../../src/ui/logic/action-registry";
import {
	applyPaletteKey,
	close,
	createPaletteState,
	filterActions,
	type PaletteAction,
} from "../../src/ui/logic/palette-state";

function actions(): PaletteAction[] {
	return buildDefaultActions({
		switchTheme: () => {},
		setPort: () => {},
		killServer: () => {},
		exportCommand: () => {},
		rescanModels: () => {},
		toggleTelemetry: () => {},
		goToTab: () => {},
		clearLog: () => {},
	});
}

const ACTIONS = actions();

describe("action registry coverage (P5-FR-09)", () => {
	it("contains exactly the spec-fixed action list", () => {
		expect(ACTIONS.map((a) => a.id).sort()).toEqual(
			[...PALETTE_ACTION_IDS].sort(),
		);
	});

	it("has 18 actions: 7 themes + 7 singletons + 4 tabs (Issue #8, #49, #50)", () => {
		expect(ACTIONS.length).toBe(18);
	});

	it("ships no orphan action until adopt lands (F4)", () => {
		expect(ACTIONS.some((a) => a.id.includes("orphan"))).toBe(false);
	});

	it("every action has a non-empty label", () => {
		for (const a of ACTIONS) expect(a.label.length).toBeGreaterThan(0);
	});

	it("actions dispatch to their handlers", () => {
		let calls = 0;
		const spy: PaletteAction[] = buildDefaultActions({
			switchTheme: () => calls++,
			setPort: () => calls++,
			killServer: () => calls++,
			exportCommand: () => calls++,
			rescanModels: () => calls++,
			toggleTelemetry: () => calls++,
			goToTab: () => calls++,
			clearLog: () => calls++,
			autoFitNgl: () => calls++,
		});
		for (const a of spy) a.run();
		expect(calls).toBe(spy.length);
	});
});

describe("fuzzy filter", () => {
	it("subsequence matching on label", () => {
		const hits = filterActions(ACTIONS, "kil");
		expect(hits.some((a) => a.id === "kill-server")).toBe(true);
		expect(hits.every((a) => a.label.toLowerCase().includes("k"))).toBe(true);
	});

	it("matches keywords too", () => {
		expect(filterActions(ACTIONS, "prometheus").length).toBe(0);
		const hits = filterActions(ACTIONS, "theme");
		expect(hits.length).toBeGreaterThanOrEqual(7);
	});

	it("empty query returns all", () => {
		expect(filterActions(ACTIONS, "").length).toBe(18);
	});

	it("no match -> empty", () => {
		expect(filterActions(ACTIONS, "zzzz")).toEqual([]);
	});

	it("earlier/compact matches rank first", () => {
		const ranked = filterActions(ACTIONS, "port");
		expect(ranked[0]?.id).toBe("set-port");
	});
});

describe("palette state machine (P5-FR-10)", () => {
	it("starts closed; toggle/open/close", () => {
		let s = createPaletteState();
		expect(s.open).toBe(false);
		s = applyPaletteKey(s, ACTIONS, { name: "p", ctrl: true });
		expect(s.open).toBe(true);
		s = close(s);
		expect(s.open).toBe(false);
		expect(s.query).toBe(""); // query resets on close
	});

	it("esc closes, printable chars fill query", () => {
		let s = createPaletteState({ open: true });
		s = applyPaletteKey(s, ACTIONS, { name: "k" });
		s = applyPaletteKey(s, ACTIONS, { name: "i" });
		s = applyPaletteKey(s, ACTIONS, { name: "l" });
		expect(s.query).toBe("kil");
		s = applyPaletteKey(s, ACTIONS, { name: "escape" });
		expect(s.open).toBe(false);
	});

	it("backspace edits query", () => {
		let s = createPaletteState({ open: true });
		for (const ch of "kix") s = applyPaletteKey(s, ACTIONS, { name: ch });
		s = applyPaletteKey(s, ACTIONS, { name: "backspace" });
		expect(s.query).toBe("ki");
	});

	it("arrow navigation clamps to result bounds", () => {
		let s = createPaletteState({ open: true });
		s = applyPaletteKey(s, ACTIONS, { name: "up" }); // at 0 stays 0
		expect(s.selected).toBe(0);
		for (let i = 0; i < 50; i++) {
			s = applyPaletteKey(s, ACTIONS, { name: "down" });
		}
		expect(s.selected).toBe(filterActions(ACTIONS, "").length - 1);
	});

	it("enter executes selected action against current results and closes", () => {
		let killed = false;
		const spy = buildDefaultActions({
			switchTheme: () => {},
			setPort: () => {},
			killServer: () => {
				killed = true;
			},
			exportCommand: () => {},
			rescanModels: () => {},
			toggleTelemetry: () => {},
			goToTab: () => {},
			clearLog: () => {},
		});
		let s = createPaletteState({ open: true });
		for (const ch of "kill") s = applyPaletteKey(s, ACTIONS, { name: ch });
		s = applyPaletteKey(s, ACTIONS, { name: "down" }); // select Kill Current Server
		s = applyPaletteKey(s, ACTIONS, { name: "return" }, spy);
		expect(killed).toBe(true);
		expect(s.open).toBe(false);
	});
});
