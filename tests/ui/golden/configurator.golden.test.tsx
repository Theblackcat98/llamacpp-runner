import { describe, it } from "bun:test";
import { createConfigurator } from "../../../src/ui/logic/configurator-state";
import { Configurator } from "../../../src/ui/screens/configurator";
import { TOKYO_NIGHT } from "../../../src/ui/themes";
import { expectGoldenFrame } from "./harness";

const MODEL = {
	path: "~/models/llm/qwen25-7b-q4km.gguf",
	blockCount: 28,
	contextLength: 131072,
	fileSize: 4_681_378_816,
	headCount: 28,
	headCountKv: 4,
	embeddingLength: 3584,
};

describe("configurator golden frames (P4-FR-06/17)", () => {
	it("renders defaults with live preview and VRAM readout", async () => {
		await expectGoldenFrame(
			"configurator-defaults",
			<Configurator
				theme={TOKYO_NIGHT}
				state={createConfigurator(MODEL)}
				focused
			/>,
			{ width: 100, height: 26 },
		);
	});

	it("renders restart-required marker after launch + ctx edit", async () => {
		const state = createConfigurator(MODEL);
		const launched = { ...state, launched: true };
		const edited = {
			...launched,
			values: { ...launched.values, ctx_size: 8192 },
			restartRequired: true,
		};
		await expectGoldenFrame(
			"configurator-restart-required",
			<Configurator theme={TOKYO_NIGHT} state={edited} focused />,
			{ width: 100, height: 26 },
		);
	});

	it("renders empty state without a model", async () => {
		await expectGoldenFrame(
			"configurator-empty",
			<Configurator theme={TOKYO_NIGHT} state={createConfigurator(null)} />,
			{ width: 100, height: 26 },
		);
	});
});
