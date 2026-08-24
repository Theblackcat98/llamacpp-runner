import { describe, it } from "bun:test";
import type { PresetFile } from "../../../src/core/store/presets";
import { PresetsScreen } from "../../../src/ui/screens/presets";
import { TOKYO_NIGHT } from "../../../src/ui/themes";
import { expectGoldenFrame } from "./harness";

const FILE: PresetFile = {
	version: 2,
	$schema: "./schema.preset.json",
	lastSession: { preset_id: "p1", tab: 3 },
	presets: [
		{
			id: "p1",
			name: "Qwen 32B Full Offload",
			model_path: "~/models/llm/qwen.gguf",
			flags: { ctx_size: 32768, future_flag: true },
			env_vars: {},
			created_at: "2026-08-24T00:00:00Z",
			last_used: null,
		},
		{
			id: "p2",
			name: "Gone Model",
			model_path: "~/models/llm/deleted.gguf",
			flags: {},
			env_vars: {},
			created_at: "2026-08-24T00:00:00Z",
			last_used: "2026-08-24T09:15:00Z",
		},
	],
};

const PATHS = new Set(["~/models/llm/qwen.gguf"]);

describe("presets golden frames (P4-FR-19)", () => {
	it("renders list with default marker and broken row", async () => {
		await expectGoldenFrame(
			"presets-list",
			<PresetsScreen
				theme={TOKYO_NIGHT}
				file={FILE}
				existingModelPaths={PATHS}
				focused
			/>,
			{ width: 110, height: 22 },
		);
	});
});
