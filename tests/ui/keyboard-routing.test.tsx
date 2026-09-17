import { afterEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import type { ModelEntry } from "../../src/core/models/types";
import { App, type AppProps } from "../../src/ui/app";
import {
	type ConfiguratorState,
	createConfigurator,
} from "../../src/ui/logic/configurator-state";
import { DEFAULT_THEME } from "../../src/ui/themes";

/**
 * #42: keyboard interference matrix — every text field × every global
 * shortcut, asserted in BOTH directions at the real App level:
 *
 *   1. the printable reaches the focused field's buffer, and
 *   2. no shell side-effect fires (tab switch, drawer toggle, modal,
 *      spy callback, confirm notice).
 *
 * Plus same-tick burst delivery: mockInput.pressKeys emits every key in one
 * synchronous tick, so state updates from the first key (field moves, editor
 * opens) have NOT committed when the next key's listeners run — the exact
 * real-terminal path (fast typing, paste, tmux send-keys) where an
 * effect-updated ownership guard skews.
 */

const MODEL: ModelEntry = {
	name: "qwen",
	path: "~/models/qwen.gguf",
	paths: ["~/models/qwen.gguf"],
	totalBytes: 20 * 1024 ** 3,
	quantName: "Q4_K_M",
	contextLength: 32768,
	blockCount: 64,
	headCount: 40,
	headCountKv: 8,
	embeddingLength: 5120,
};

/** createConfigurator additionally requires the file size (ConfiguratorModel). */
const CONFIG_MODEL = { ...MODEL, fileSize: MODEL.totalBytes };

/** Global printable bindings that a focused text field must own. */
const YIELD_KEYS = [
	"1",
	"2",
	"3",
	"4",
	"o",
	"x",
	"k",
	"q",
	"r",
	"i",
	"y",
	"t",
	"a",
	"?",
];

interface Spies {
	launch: number;
	kill: number;
	killOrphan: number;
	savePreset: number;
	yank: number;
	confirmHost: number;
	quit: number;
	rescan: number;
	setModelsDir: number;
	enableTelemetry: number;
	autoFit: number;
}

function makeSpies(): Spies {
	return {
		launch: 0,
		kill: 0,
		killOrphan: 0,
		savePreset: 0,
		yank: 0,
		confirmHost: 0,
		quit: 0,
		rescan: 0,
		setModelsDir: 0,
		enableTelemetry: 0,
		autoFit: 0,
	};
}

type Setup = Awaited<ReturnType<typeof testRender>>;

const setups: Setup[] = [];
afterEach(async () => {
	for (const s of setups.splice(0)) {
		await act(async () => {
			s.renderer.destroy();
		});
	}
});

interface Harness {
	setup: Setup;
	spies: Spies;
	getConfiguratorState: () => ConfiguratorState;
	frame: () => string;
	/** One key per commit cycle — each key sees fully committed state. */
	press: (...keys: string[]) => Promise<void>;
	/** Every key inside one tick — no commits between keys (burst/paste). */
	burst: (...keys: string[]) => Promise<void>;
}

async function renderApp(
	props: Partial<AppProps> & { serverRunning?: boolean } = {},
): Promise<Harness> {
	const spies = makeSpies();
	let configuratorState = createConfigurator(CONFIG_MODEL);
	const base: AppProps = {
		theme: DEFAULT_THEME,
		onQuit: () => spies.quit++,
		onLaunch: () => spies.launch++,
		onKill: () => spies.kill++,
		onKillOrphan: () => spies.killOrphan++,
		onSavePreset: () => spies.savePreset++,
		onYankCommand: () => spies.yank++,
		onConfirmHost: () => spies.confirmHost++,
		serverRunning: false,
		explorerControl: {
			entries: [MODEL],
			scanning: false,
			modelsDir: "~/models",
			onRescan: () => spies.rescan++,
			onSetModelsDir: () => spies.setModelsDir++,
		},
		configuratorControl: {
			state: configuratorState,
			setState: (next) => {
				configuratorState = next;
			},
			onAutoFit: () => spies.autoFit++,
		},
		telemetryControl: {
			vm: null,
			onEnableTelemetry: () => spies.enableTelemetry++,
		},
	};
	const setup = await testRender(<App {...base} {...(props as AppProps)} />, {
		width: 100,
		height: 30,
	});
	setups.push(setup);
	const harness: Harness = {
		setup,
		spies,
		getConfiguratorState: () => configuratorState,
		frame: () => setup.captureCharFrame(),
		press: async (...keys) => {
			for (const key of keys) {
				await act(async () => {
					await setup.mockInput.pressKeys([key]);
					if (key === "\x1b") {
						// Lone ESC is held by OpenTUI's escape-disambiguation
						// timer; let it flush (see explorer-change-dir tests).
						await new Promise((r) => setTimeout(r, 120));
					}
				});
				await act(async () => {
					await setup.flush();
				});
			}
		},
		burst: async (...keys) => {
			await act(async () => {
				await setup.mockInput.pressKeys(keys);
			});
			await act(async () => {
				await setup.flush();
			});
		},
	};
	await act(async () => {
		await setup.flush();
	});
	return harness;
}

function expectNoShellSideEffects(h: Harness) {
	expect(h.frame()).toContain("Launch config");
	const { spies } = h;
	expect(spies.launch).toBe(0);
	expect(spies.kill).toBe(0);
	expect(spies.killOrphan).toBe(0);
	expect(spies.savePreset).toBe(0);
	expect(spies.yank).toBe(0);
	expect(spies.confirmHost).toBe(0);
	expect(spies.quit).toBe(0);
	expect(spies.rescan).toBe(0);
	expect(spies.setModelsDir).toBe(0);
	expect(spies.enableTelemetry).toBe(0);
	expect(spies.autoFit).toBe(0);
}

/** Configurator field walk targets (field order in configurator.tsx). */
const FIELDS = [
	{ label: "host", downs: 12, valueKey: "host", numeric: false },
	{ label: "port", downs: 13, valueKey: "port", numeric: true },
	{ label: "alias", downs: 14, valueKey: "alias", numeric: false },
	{
		label: "chat-template",
		downs: 15,
		valueKey: "chat_template",
		numeric: false,
	},
] as const;

describe("text field × global shortcut matrix (Launch Config)", () => {
	for (const field of FIELDS) {
		it(`yields every global printable to the ${field.label} field`, async () => {
			const h = await renderApp();
			await h.press("2");
			expect(h.frame()).toContain("Launch config");
			for (let i = 0; i < field.downs; i++) {
				await h.press("\x1b[B"); // down
			}
			// Seed the expected buffer with what the controlled input shows:
			// strValue semantics — non-string values render as empty buffers.
			const initial = h.getConfiguratorState().values[field.valueKey];
			let expected = typeof initial === "string" ? initial : "";
			for (const key of YIELD_KEYS) {
				await h.press(key);
				expectNoShellSideEffects(h);
				const accepted = !field.numeric || /^[0-9]$/.test(key);
				if (accepted) expected += key;
				const value = h.getConfiguratorState().values[field.valueKey];
				if (field.numeric) {
					// Empty port buffers fall back to the 8080 default on change.
					expect(value).toBe(expected === "" ? 8080 : Number(expected));
				} else {
					expect(value).toBe(expected);
				}
			}
		});
	}
});

describe("text field × global shortcut matrix (Explorer dir editor)", () => {
	it("yields every global printable to the models-dir field", async () => {
		const h = await renderApp();
		expect(h.frame()).toContain("Models");
		await h.press("m");
		expect(h.frame()).toContain("Set models directory");
		let expected = "";
		for (const key of YIELD_KEYS) {
			await h.press(key);
			// Editor stays open, tab never moves, nothing fires.
			expect(h.frame()).toContain("Set models directory");
			expect(h.frame()).not.toContain("Launch config");
			expect(h.spies.quit).toBe(0);
			expect(h.spies.launch).toBe(0);
			expect(h.spies.rescan).toBe(0);
			expect(h.spies.setModelsDir).toBe(0);
			expected += key;
		}
		// The buffer holds everything typed (placeholder only shows when empty).
		expect(h.frame()).toContain(expected);
		// Enter confirms the editor — it must not launch the server.
		await h.press("\r");
		expect(h.spies.setModelsDir).toBe(1);
		expect(h.spies.launch).toBe(0);
		expect(h.frame()).not.toContain("Set models directory");
	});
});

describe("same-tick burst delivery", () => {
	it("down into host + digit in one tick keeps the tab and delivers the digit", async () => {
		const h = await renderApp();
		await h.press("2");
		for (let i = 0; i < 11; i++) {
			await h.press("\x1b[B"); // down to the threads slider (field 11)
		}
		await h.burst("\x1b[B", "1"); // into host + digit before commit
		expectNoShellSideEffects(h);
		// Host starts from its 127.0.0.1 default; the burst digit appends.
		expect(h.getConfiguratorState().values.host).toBe("127.0.0.11");
	});

	it("wrap-around up into chat-template + digit in one tick keeps the tab", async () => {
		const h = await renderApp();
		await h.press("2"); // field 0 (GPU slider)
		await h.burst("\x1b[A", "1"); // up wraps to chat-template (field 15)
		expectNoShellSideEffects(h);
		expect(h.getConfiguratorState().values.chat_template).toBe("1");
	});

	it("paste-style 1234 into a focused alias stays on the tab", async () => {
		const h = await renderApp();
		await h.press("2");
		for (let i = 0; i < 14; i++) {
			await h.press("\x1b[B"); // down to alias (field 14)
		}
		await h.burst("1", "2", "3", "4");
		expectNoShellSideEffects(h);
		expect(h.getConfiguratorState().values.alias).toBe("1234");
	});

	it("m + digit in one tick opens the dir editor without switching tabs", async () => {
		const h = await renderApp();
		await h.burst("m", "2");
		expect(h.frame()).toContain("Set models directory");
		expect(h.frame()).not.toContain("Launch config");
		expect(h.spies.launch).toBe(0);
	});
});

describe("inverse: global shortcuts still fire when no text field owns typing", () => {
	it("digits switch tabs, o toggles the drawer, r rescans, help and import toggle", async () => {
		const h = await renderApp();
		await h.press("2");
		expect(h.frame()).toContain("Launch config");
		await h.press("3");
		// #45: the dormant telemetry screen is a borderless message now.
		expect(h.frame()).toContain("telemetry disabled");
		await h.press("4");
		expect(h.frame()).toContain("Presets arrives");
		await h.press("1");
		expect(h.frame()).toContain("Models");
		expect(h.frame()).not.toContain("Launch config");

		await h.press("o");
		expect(h.frame()).toContain("Console (o to expand)");
		await h.press("o");
		expect(h.frame()).not.toContain("Console (o to expand)");

		await h.press("r");
		expect(h.spies.rescan).toBe(1);

		await h.press("?");
		expect(h.frame()).toContain("Keyboard shortcuts");
		await h.press("?");
		expect(h.frame()).not.toContain("Keyboard shortcuts");

		await h.press("2");
		await h.press("i");
		expect(h.frame()).toContain("Import shell command");
		await h.press("\x1b"); // escape closes the import modal
		expect(h.frame()).not.toContain("Import shell command");

		await h.press("y");
		expect(h.spies.yank).toBe(1);

		await h.press("a"); // field 0 (GPU slider) is not a text field
		expect(h.spies.autoFit).toBe(1);

		await h.press("3");
		await h.press("t");
		expect(h.spies.enableTelemetry).toBe(1);

		await h.press("1");
		await h.press("\r"); // Enter launches outside Presets
		expect(h.spies.launch).toBe(1);
	});

	it("Enter on the Presets tab never launches", async () => {
		const h = await renderApp();
		await h.press("4");
		await h.press("\r");
		expect(h.spies.launch).toBe(0);
	});

	it("q quits immediately when no server is running", async () => {
		const h = await renderApp();
		await h.press("q");
		expect(h.spies.quit).toBe(1);
	});

	it("FAILED state: single q quits cleanly, no confirm (#56)", async () => {
		const h = await renderApp({ serverFailed: true });
		expect(h.frame()).toContain("server failed");
		expect(h.frame()).not.toContain("server running");
		await h.press("q");
		expect(h.spies.quit).toBe(1);
		// x offers nothing to kill for a dead supervisor.
		expect(h.frame()).not.toContain("press x again");
	});

	it("x/k/q confirm flows arm first, then execute while a server runs", async () => {
		const h = await renderApp({ serverRunning: true, foundOrphanPid: 4242 });
		// #55: the Explorer table owns k for navigation — the orphan-kill
		// flow is exercised on the Configurator, where no table claims k.
		await h.press("2");
		expect(h.frame()).toContain("Launch config");
		await h.press("x");
		expect(h.frame()).toContain("press x again to confirm");
		expect(h.spies.kill).toBe(0);
		await h.press("x");
		expect(h.spies.kill).toBe(1);

		await h.press("k");
		expect(h.frame()).toContain("press k again within 2s");
		expect(h.spies.killOrphan).toBe(0);
		await h.press("k");
		expect(h.spies.killOrphan).toBe(1);

		await h.press("q");
		expect(h.frame()).toContain("within 2s to quit");
		expect(h.spies.quit).toBe(0);
		await h.press("q");
		expect(h.spies.quit).toBe(1);
	});

	it("k in the focused Explorer table never arms the orphan kill (#55)", async () => {
		const h = await renderApp({ serverRunning: true, foundOrphanPid: 4242 });
		await h.press("k");
		await h.press("k");
		expect(h.spies.killOrphan).toBe(0);
		expect(h.frame()).not.toContain("press k again");
	});
});
