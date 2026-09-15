import { afterEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import type { ModelEntry } from "../../src/core/models/types";
import type { PresetFile } from "../../src/core/store/presets";
import { App } from "../../src/ui/app";
import { createConfigurator } from "../../src/ui/logic/configurator-state";
import { PresetsScreen } from "../../src/ui/screens/presets";
import { DEFAULT_THEME, TOKYO_NIGHT } from "../../src/ui/themes";

const setups: { renderer: { destroy: () => void } }[] = [];
afterEach(async () => {
	for (const s of setups.splice(0)) {
		(
			globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		await act(async () => {
			s.renderer.destroy();
		});
	}
});

const PRESET_FILE: PresetFile = {
	version: 2,
	presets: [
		{
			id: "p1",
			name: "Qwen 32B",
			model_path: "~/models/qwen.gguf",
			flags: {},
			env_vars: {},
			created_at: "2026-08-24T00:00:00Z",
			last_used: null,
		},
	],
};

const BROKEN_FILE: PresetFile = {
	version: 2,
	presets: [
		{
			id: "p9",
			name: "Stale preset",
			model_path: "/gone/old.gguf",
			flags: {},
			env_vars: {},
			created_at: "2026-08-24T00:00:00Z",
			last_used: null,
		},
	],
};

const ENTRY: ModelEntry = {
	name: "qwen25-7b-q4km.gguf",
	path: "/models/llm/qwen25-7b-q4km.gguf",
	paths: ["/models/llm/qwen25-7b-q4km.gguf"],
	totalBytes: 4_681_378_816,
	architecture: "qwen2",
	quantName: "Q4_K_M",
	contextLength: 131072,
	blockCount: 28,
	embeddingLength: 3584,
	headCount: 28,
	headCountKv: 4,
	totalParams: 6_518_222_848,
	effectiveBpw: 5.75,
};

async function gotoPresets(
	setup: Awaited<ReturnType<typeof testRender>>,
): Promise<void> {
	await act(async () => {
		await setup.mockInput.pressKeys(["4"]);
	});
	await act(async () => {
		await setup.flush();
	});
	expect(setup.captureCharFrame()).toContain("PRESETS");
}

/**
 * F3: Enter on the Presets tab must own set-default — the shell's global
 * launch must not fire there (one owner per key, Phase 13).
 */
describe("preset Enter ownership (F3)", () => {
	it("Enter on Presets sets default without launching", async () => {
		const launches: unknown[] = [];
		const defaults: string[] = [];
		const setup = await testRender(
			<App
				theme={DEFAULT_THEME}
				onLaunch={() => {
					launches.push(1);
				}}
				presetsControl={{
					file: PRESET_FILE,
					existingModelPaths: new Set(["~/models/qwen.gguf"]),
					onSetDefault: (id) => {
						defaults.push(id);
					},
				}}
			/>,
			{ width: 100, height: 30 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		await gotoPresets(setup);
		await act(async () => {
			await setup.mockInput.pressKeys(["\r"]);
		});
		await act(async () => {
			await setup.flush();
		});
		expect(defaults).toEqual(["p1"]);
		expect(launches).toEqual([]);
	});
});

/**
 * F3: `l` loads the preset into the Configurator AND jumps there, so Enter
 * launches through the single tested path.
 */
describe("preset load-and-go (F3)", () => {
	it("l loads the preset and switches to Launch Config", async () => {
		const loaded: string[] = [];
		const setup = await testRender(
			<App
				theme={DEFAULT_THEME}
				presetsControl={{
					file: PRESET_FILE,
					existingModelPaths: new Set(["~/models/qwen.gguf"]),
					onLoad: (p) => {
						loaded.push(p.id);
					},
				}}
				configuratorControl={{
					state: createConfigurator(null),
					setState: () => {},
				}}
			/>,
			{ width: 100, height: 30 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		await gotoPresets(setup);
		await act(async () => {
			await setup.mockInput.pressKeys(["l"]);
		});
		await act(async () => {
			await setup.flush();
		});
		expect(loaded).toEqual(["p1"]);
		expect(setup.captureCharFrame()).toContain("LAUNCH CONFIG");
	});
});

/**
 * F3: `r` re-links a broken preset to the Explorer selection (P4-FR-18).
 */
describe("preset re-link (F3, P4-FR-18)", () => {
	it("r relinks a broken preset to the given target", async () => {
		const relinked: [string, string][] = [];
		const setup = await testRender(
			<PresetsScreen
				theme={TOKYO_NIGHT}
				file={BROKEN_FILE}
				existingModelPaths={new Set()}
				focused
				relinkTarget={{ path: "/models/llm/qwen25-7b-q4km.gguf" }}
				onRelink={(id, path) => {
					relinked.push([id, path]);
				}}
			/>,
			{ width: 100, height: 20 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		await act(async () => {
			await setup.mockInput.pressKeys(["r"]);
		});
		await act(async () => {
			await setup.flush();
		});
		expect(relinked).toEqual([["p9", "/models/llm/qwen25-7b-q4km.gguf"]]);
	});

	it("r is a no-op without a target or on a healthy preset", async () => {
		const relinked: [string, string][] = [];
		const noTarget = await testRender(
			<PresetsScreen
				theme={TOKYO_NIGHT}
				file={BROKEN_FILE}
				existingModelPaths={new Set()}
				focused
				onRelink={(id, path) => {
					relinked.push([id, path]);
				}}
			/>,
			{ width: 100, height: 20 },
		);
		setups.push(noTarget);
		await act(async () => {
			await noTarget.flush();
		});
		await act(async () => {
			await noTarget.mockInput.pressKeys(["r"]);
		});
		await act(async () => {
			await noTarget.flush();
		});
		const healthy = await testRender(
			<PresetsScreen
				theme={TOKYO_NIGHT}
				file={PRESET_FILE}
				existingModelPaths={new Set(["~/models/qwen.gguf"])}
				focused
				relinkTarget={{ path: "/models/llm/qwen25-7b-q4km.gguf" }}
				onRelink={(id, path) => {
					relinked.push([id, path]);
				}}
			/>,
			{ width: 100, height: 20 },
		);
		setups.push(healthy);
		await act(async () => {
			await healthy.flush();
		});
		await act(async () => {
			await healthy.mockInput.pressKeys(["r"]);
		});
		await act(async () => {
			await healthy.flush();
		});
		expect(relinked).toEqual([]);
	});

	it("r in the shell relinks to the Explorer selection", async () => {
		const relinked: [string, string][] = [];
		const setup = await testRender(
			<App
				theme={DEFAULT_THEME}
				explorerControl={{
					entries: [ENTRY],
					scanning: false,
					modelsDir: "/models/llm",
					selectedIndex: 0,
					onRescan: () => {},
					onUseDefaultDir: () => {},
				}}
				presetsControl={{
					file: BROKEN_FILE,
					existingModelPaths: new Set(),
					onRelink: (id, path) => {
						relinked.push([id, path]);
					},
				}}
			/>,
			{ width: 100, height: 30 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		await gotoPresets(setup);
		await act(async () => {
			await setup.mockInput.pressKeys(["r"]);
		});
		await act(async () => {
			await setup.flush();
		});
		expect(relinked).toEqual([["p9", "/models/llm/qwen25-7b-q4km.gguf"]]);
	});
});
