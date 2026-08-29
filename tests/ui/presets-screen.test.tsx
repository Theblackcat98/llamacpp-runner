import { afterEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import type { PresetFile } from "../../src/core/store/presets";
import { PresetsScreen } from "../../src/ui/screens/presets";
import { TOKYO_NIGHT } from "../../src/ui/themes";

const setups: { renderer: { destroy: () => void } }[] = [];
afterEach(async () => {
	for (const s of setups.splice(0)) {
		await act(async () => {
			s.renderer.destroy();
		});
	}
});

const FILE: PresetFile = {
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

/**
 * Phase 13: deletion is destructive, so `d` arms and a second `d` within 2 s
 * executes — a single stray keypress never deletes a preset.
 */
describe("presets delete confirmation (Phase 13)", () => {
	it("first d arms (no delete); second d within window deletes", async () => {
		const deleted: string[] = [];
		const setup = await testRender(
			<PresetsScreen
				theme={TOKYO_NIGHT}
				file={FILE}
				existingModelPaths={new Set(["~/models/qwen.gguf"])}
				focused
				onDelete={(id) => {
					deleted.push(id);
				}}
			/>,
			{ width: 100, height: 20 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});

		await act(async () => {
			await setup.mockInput.pressKeys(["d"]);
		});
		await act(async () => {
			await setup.flush();
		});
		expect(deleted).toEqual([]);
		expect(setup.captureCharFrame()).toContain("confirm delete");

		await act(async () => {
			await setup.mockInput.pressKeys(["d"]);
		});
		await act(async () => {
			await setup.flush();
		});
		expect(deleted).toEqual(["p1"]);
	});

	it("delete arm never fires other actions", async () => {
		let loads = 0;
		const setup = await testRender(
			<PresetsScreen
				theme={TOKYO_NIGHT}
				file={FILE}
				existingModelPaths={new Set(["~/models/qwen.gguf"])}
				focused
				onLoad={() => {
					loads++;
				}}
			/>,
			{ width: 100, height: 20 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		await act(async () => {
			await setup.mockInput.pressKeys(["d"]);
		});
		await act(async () => {
			await setup.flush();
		});
		expect(loads).toBe(0);
	});
});
