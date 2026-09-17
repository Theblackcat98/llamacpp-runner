import { describe, expect, it } from "bun:test";
import {
	routeShellKey,
	type ShellKeyContext,
} from "../../src/ui/logic/shell-key-routing";

const NOW = 10_000;
const WINDOW = 2000;

function ctx(overrides: Partial<ShellKeyContext> = {}): ShellKeyContext {
	return {
		tab: 0,
		focusPane: 0,
		textFieldActive: false,
		dirEditorOpen: false,
		paletteOpen: false,
		importOpen: false,
		serverRunning: false,
		confirm: { pending: null, armedAt: null },
		killArmedAt: null,
		nowMs: NOW,
		hasLaunch: true,
		hasExplorer: true,
		hasSavePreset: true,
		hasYank: true,
		hasConfirmHost: true,
		// #55: the k tests below assume an orphan exists and no list owns k.
		foundOrphanPid: 4242,
		tableFocused: false,
		...overrides,
	};
}

function armed(
	kind: "quit" | "kill" | "host",
	at: number,
): ShellKeyContext["confirm"] {
	return { pending: kind, armedAt: at };
}

const PRINTABLES = [
	"1",
	"2",
	"3",
	"4",
	"5",
	"a",
	"o",
	"x",
	"k",
	"q",
	"r",
	"i",
	"y",
	"t",
	"?",
];

describe("import modal owns every key while open", () => {
	it("no actions for any printable", () => {
		for (const name of PRINTABLES) {
			expect(routeShellKey(ctx({ importOpen: true }), { name })).toEqual([]);
		}
	});

	it("no actions for control keys either", () => {
		for (const key of [
			{ name: "p", ctrl: true },
			{ name: "c", ctrl: true },
			{ name: "s", ctrl: true },
			{ name: "l", ctrl: true },
			{ name: "y", ctrl: true },
			{ name: "return" },
			{ name: "escape" },
			{ name: "tab" },
		]) {
			expect(routeShellKey(ctx({ importOpen: true }), key)).toEqual([]);
		}
	});
});

describe("command palette routes first while open", () => {
	it("every key becomes a paletteKey while the palette is open", () => {
		for (const name of PRINTABLES) {
			expect(routeShellKey(ctx({ paletteOpen: true }), { name })).toEqual([
				{ type: "paletteKey", key: { name } },
			]);
		}
		for (const key of [
			{ name: "up" },
			{ name: "down" },
			{ name: "escape" },
			{ name: "return" },
			{ name: "backspace" },
			{ name: "tab" },
		]) {
			expect(routeShellKey(ctx({ paletteOpen: true }), key)).toEqual([
				{ type: "paletteKey", key },
			]);
		}
	});

	it("Ctrl+P opens the palette even when closed", () => {
		expect(routeShellKey(ctx(), { name: "p", ctrl: true })).toEqual([
			{ type: "paletteKey", key: { name: "p", ctrl: true } },
		]);
	});
});

describe("one-owner rule: text fields swallow plain printables", () => {
	it("single-char keys yield to the field in both text contexts", () => {
		for (const name of PRINTABLES) {
			expect(
				routeShellKey(ctx({ tab: 1, textFieldActive: true }), { name }),
			).toEqual([{ type: "yieldToField" }]);
			expect(
				routeShellKey(
					ctx({ tab: 0, dirEditorOpen: true, textFieldActive: true }),
					{ name },
				),
			).toEqual([{ type: "yieldToField" }]);
		}
	});

	it("Ctrl combos still pass through while typing", () => {
		expect(
			routeShellKey(ctx({ tab: 1, textFieldActive: true }), {
				name: "s",
				ctrl: true,
			}),
		).toEqual([{ type: "savePreset" }]);
		expect(
			routeShellKey(ctx({ tab: 1, textFieldActive: true }), {
				name: "c",
				ctrl: true,
			})[0]?.type,
		).toBe("setConfirm");
	});

	it("multi-char names are not printables and fall through", () => {
		expect(
			routeShellKey(ctx({ tab: 1, textFieldActive: true }), { name: "up" }),
		).toEqual([]);
		expect(
			routeShellKey(ctx({ tab: 1, textFieldActive: true }), {
				name: "return",
			}),
		).toEqual([{ type: "launch" }]);
	});
});

describe("? toggles the help overlay", () => {
	it("routes toggleHelp on any tab", () => {
		for (const tab of [0, 1, 2, 3]) {
			expect(routeShellKey(ctx({ tab }), { name: "?" })).toEqual([
				{ type: "toggleHelp" },
			]);
		}
	});
});

describe("quit key (q / Ctrl+C) confirmation windows", () => {
	it("no server -> immediate quit with reset state", () => {
		expect(routeShellKey(ctx(), { name: "q" })).toEqual([
			{ type: "setConfirm", state: { pending: null, armedAt: null } },
			{ type: "setNotice", notice: null },
			{ type: "quit" },
		]);
		expect(routeShellKey(ctx(), { name: "c", ctrl: true }).at(-1)).toEqual({
			type: "quit",
		});
	});

	it("server running, first press -> arm with notice", () => {
		const actions = routeShellKey(ctx({ serverRunning: true }), { name: "q" });
		expect(actions).toEqual([
			{
				type: "setConfirm",
				state: { pending: "quit", armedAt: NOW },
			},
			{
				type: "setNotice",
				notice: "server running — Ctrl+C again within 2s to quit",
			},
		]);
	});

	it("second press within the window quits", () => {
		const actions = routeShellKey(
			ctx({ serverRunning: true, confirm: armed("quit", NOW - 1500) }),
			{ name: "q" },
		);
		expect(actions).toEqual([
			{ type: "setConfirm", state: { pending: null, armedAt: null } },
			{ type: "setNotice", notice: null },
			{ type: "quit" },
		]);
	});

	it("second press after the window re-arms", () => {
		const actions = routeShellKey(
			ctx({ serverRunning: true, confirm: armed("quit", NOW - WINDOW - 1) }),
			{ name: "q" },
		);
		expect(actions).toEqual([
			{ type: "setConfirm", state: { pending: "quit", armedAt: NOW } },
			{ type: "setNotice", notice: expect.any(String) },
		]);
	});
});

describe("Enter ownership", () => {
	it("launches when a handler exists outside Presets and the dir editor", () => {
		expect(routeShellKey(ctx({ tab: 0 }), { name: "return" })).toEqual([
			{ type: "launch" },
		]);
		expect(routeShellKey(ctx({ tab: 1 }), { name: "return" })).toEqual([
			{ type: "launch" },
		]);
	});

	it("never launches on the Presets tab", () => {
		expect(routeShellKey(ctx({ tab: 3 }), { name: "return" })).toEqual([]);
	});

	it("yields Enter to the open dir editor", () => {
		expect(
			routeShellKey(ctx({ tab: 0, dirEditorOpen: true }), {
				name: "return",
			}),
		).toEqual([]);
	});

	it("no launch handler -> falls through", () => {
		expect(
			routeShellKey(ctx({ tab: 0, hasLaunch: false }), { name: "return" }),
		).toEqual([]);
	});
});

describe("x kill confirmation windows", () => {
	it("no server -> state reset only, no kill", () => {
		expect(routeShellKey(ctx(), { name: "x" })).toEqual([
			{ type: "setConfirm", state: { pending: null, armedAt: null } },
		]);
	});

	it("server running, first x -> arm with notice", () => {
		expect(routeShellKey(ctx({ serverRunning: true }), { name: "x" })).toEqual([
			{ type: "setConfirm", state: { pending: "kill", armedAt: NOW } },
			{
				type: "setNotice",
				notice: "kill running server — press x again to confirm",
			},
		]);
	});

	it("second x within the window executes", () => {
		const actions = routeShellKey(
			ctx({ serverRunning: true, confirm: armed("kill", NOW - 1000) }),
			{ name: "x" },
		);
		expect(actions).toEqual([
			{ type: "setConfirm", state: { pending: null, armedAt: null } },
			{ type: "setNotice", notice: null },
			{ type: "kill" },
		]);
	});
});

describe("k orphan-kill arm/execute window", () => {
	it("first k arms with the notice", () => {
		expect(routeShellKey(ctx(), { name: "k" })).toEqual([
			{ type: "armKillOrphan", nowMs: NOW },
			{
				type: "setNotice",
				notice: "press k again within 2s to kill the orphaned server",
			},
		]);
	});

	it("second k within 2s executes", () => {
		expect(
			routeShellKey(ctx({ killArmedAt: NOW - 1999 }), { name: "k" }),
		).toEqual([
			{ type: "setNotice", notice: null },
			{ type: "executeKillOrphan" },
		]);
	});

	it("second k after 2s re-arms", () => {
		expect(
			routeShellKey(ctx({ killArmedAt: NOW - WINDOW - 1 }), { name: "k" }),
		).toEqual([
			{ type: "armKillOrphan", nowMs: NOW },
			{
				type: "setNotice",
				notice: "press k again within 2s to kill the orphaned server",
			},
		]);
	});
});

describe("k gating (#55 one-owner rule)", () => {
	it("no orphan found: k is a no-op — no arm, no notice", () => {
		expect(routeShellKey(ctx({ foundOrphanPid: null }), { name: "k" })).toEqual(
			[],
		);
		expect(
			routeShellKey(ctx({ foundOrphanPid: null, killArmedAt: NOW - 100 }), {
				name: "k",
			}),
		).toEqual([]);
	});

	it("a focused table owns k: no arm even when an orphan exists", () => {
		expect(routeShellKey(ctx({ tableFocused: true }), { name: "k" })).toEqual(
			[],
		);
		expect(
			routeShellKey(ctx({ tableFocused: true, killArmedAt: NOW - 100 }), {
				name: "k",
			}),
		).toEqual([]);
	});
});

describe("global single-key bindings", () => {
	it("Ctrl+L clears the log", () => {
		expect(routeShellKey(ctx(), { name: "l", ctrl: true })).toEqual([
			{ type: "clearLog" },
		]);
	});

	it("o toggles the drawer", () => {
		expect(routeShellKey(ctx(), { name: "o" })).toEqual([
			{ type: "toggleDrawer" },
		]);
	});

	it("r rescans only on the Explorer tab with an explorer", () => {
		expect(routeShellKey(ctx({ tab: 0 }), { name: "r" })).toEqual([
			{ type: "rescan" },
		]);
		expect(routeShellKey(ctx({ tab: 1 }), { name: "r" })).toEqual([]);
		expect(
			routeShellKey(ctx({ tab: 0, hasExplorer: false }), { name: "r" }),
		).toEqual([]);
	});
});

describe("Ctrl+S accepts both event forms, tab 1 only", () => {
	it("named form saves on the Configurator", () => {
		expect(routeShellKey(ctx({ tab: 1 }), { name: "s", ctrl: true })).toEqual([
			{ type: "savePreset" },
		]);
	});

	it("raw sequence form (\\x13) also saves", () => {
		expect(
			routeShellKey(ctx({ tab: 1 }), { sequence: "\x13", ctrl: true }),
		).toEqual([{ type: "savePreset" }]);
	});

	it("gated by tab and handler presence", () => {
		expect(routeShellKey(ctx({ tab: 0 }), { name: "s", ctrl: true })).toEqual(
			[],
		);
		expect(
			routeShellKey(ctx({ tab: 1, hasSavePreset: false }), {
				name: "s",
				ctrl: true,
			}),
		).toEqual([]);
	});
});

describe("y yanks on the Configurator", () => {
	it("y routes on tab 1", () => {
		expect(routeShellKey(ctx({ tab: 1 }), { name: "y" })).toEqual([
			{ type: "yank" },
		]);
	});

	it("plain y does nothing elsewhere; Ctrl+Y is the host confirm", () => {
		expect(routeShellKey(ctx({ tab: 0 }), { name: "y" })).toEqual([]);
		expect(
			routeShellKey(ctx({ tab: 1 }), { name: "y", ctrl: true })[0]?.type,
		).toBe("setConfirm");
	});
});

describe("i opens the import modal on Configurator and Presets", () => {
	it("routes on tabs 1 and 3", () => {
		expect(routeShellKey(ctx({ tab: 1 }), { name: "i" })).toEqual([
			{ type: "openImport" },
		]);
		expect(routeShellKey(ctx({ tab: 3 }), { name: "i" })).toEqual([
			{ type: "openImport" },
		]);
	});

	it("does nothing on tabs 0 and 2", () => {
		expect(routeShellKey(ctx({ tab: 0 }), { name: "i" })).toEqual([]);
		expect(routeShellKey(ctx({ tab: 2 }), { name: "i" })).toEqual([]);
	});
});

describe("Ctrl+Y host-exposure confirmation", () => {
	it("first press arms with the notice", () => {
		expect(routeShellKey(ctx(), { name: "y", ctrl: true })).toEqual([
			{ type: "setConfirm", state: { pending: "host", armedAt: NOW } },
			{
				type: "setNotice",
				notice: "host binds ALL interfaces — press Ctrl+Y again to confirm",
			},
		]);
	});

	it("second press within the window executes", () => {
		const actions = routeShellKey(ctx({ confirm: armed("host", NOW - 500) }), {
			name: "y",
			ctrl: true,
		});
		expect(actions).toEqual([
			{ type: "setConfirm", state: { pending: null, armedAt: null } },
			{ type: "setNotice", notice: null },
			{ type: "confirmHost" },
		]);
	});

	it("gated by handler presence", () => {
		expect(
			routeShellKey(ctx({ hasConfirmHost: false }), {
				name: "y",
				ctrl: true,
			}),
		).toEqual([]);
	});
});

describe("t enables telemetry on the Telemetry tab", () => {
	it("routes on tab 2 and swallows elsewhere", () => {
		expect(routeShellKey(ctx({ tab: 2 }), { name: "t" })).toEqual([
			{ type: "enableTelemetry" },
		]);
		expect(routeShellKey(ctx({ tab: 0 }), { name: "t" })).toEqual([]);
	});
});

describe("Tab cycles focus between the two panes", () => {
	it("forward by default, back with shift", () => {
		expect(routeShellKey(ctx(), { name: "tab" })).toEqual([
			{ type: "cycleFocusPane", forward: true },
		]);
		expect(routeShellKey(ctx(), { name: "tab", shift: true })).toEqual([
			{ type: "cycleFocusPane", forward: false },
		]);
	});
});

describe("digit tab switching", () => {
	it("1-4 switch tabs (0-indexed action)", () => {
		for (let d = 1; d <= 4; d++) {
			expect(routeShellKey(ctx(), { name: String(d) })).toEqual([
				{ type: "switchTab", tab: d - 1 },
			]);
		}
	});

	it("5-9 are out of range and fall through", () => {
		for (const d of ["5", "6", "7", "8", "9"]) {
			expect(routeShellKey(ctx(), { name: d })).toEqual([]);
		}
	});
});

describe("drawer keys when the console pane owns focus", () => {
	it("up/down scroll, g/end pin to tail", () => {
		const base = { focusPane: 1 };
		expect(routeShellKey(ctx(base), { name: "up" })).toEqual([
			{ type: "drawerScroll", by: -1 },
		]);
		expect(routeShellKey(ctx(base), { name: "down" })).toEqual([
			{ type: "drawerScroll", by: 1 },
		]);
		expect(routeShellKey(ctx(base), { name: "g" })).toEqual([
			{ type: "drawerPinTail" },
		]);
		expect(routeShellKey(ctx(base), { name: "end" })).toEqual([
			{ type: "drawerPinTail" },
		]);
	});

	it("digits still switch tabs from the drawer", () => {
		expect(routeShellKey(ctx({ focusPane: 1 }), { name: "2" })).toEqual([
			{ type: "switchTab", tab: 1 },
		]);
	});

	it("drawer keys are inert when the content pane owns focus", () => {
		expect(routeShellKey(ctx({ focusPane: 0 }), { name: "up" })).toEqual([]);
		expect(routeShellKey(ctx({ focusPane: 0 }), { name: "end" })).toEqual([]);
	});
});

describe("unknown keys are no-ops", () => {
	it("unbound names produce no actions", () => {
		for (const name of ["a", "z", "f1", "backspace", "escape"]) {
			expect(routeShellKey(ctx(), { name })).toEqual([]);
		}
	});
});
