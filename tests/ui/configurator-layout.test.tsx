import { describe, expect, it } from "bun:test";
import { act } from "react";
import { createConfigurator } from "../../src/ui/logic/configurator-state";
import { Configurator } from "../../src/ui/screens/configurator";
import { TOKYO_NIGHT } from "../../src/ui/themes";
import {
	expectGoldenFrame,
	renderWithAct,
	teardownWithAct,
} from "./golden/harness";

const MODEL = {
	path: "~/models/llm/qwen25-7b-q4km.gguf",
	blockCount: 28,
	contextLength: 131072,
	fileSize: 4_681_378_816,
	headCount: 28,
	headCountKv: 4,
	embeddingLength: 3584,
};

function configurator() {
	return (
		<Configurator
			theme={TOKYO_NIGHT}
			state={createConfigurator(MODEL)}
			focused
		/>
	);
}

describe("configurator layout (#39)", () => {
	it("matches the 140x40 configurator golden frame", async () => {
		await expectGoldenFrame("configurator-140x40", configurator(), {
			width: 140,
			height: 40,
		});
	});

	it("keeps the minimum 100x30 frame rectangular and readable", async () => {
		const setup = await renderWithAct(configurator(), {
			width: 100,
			height: 30,
		});
		try {
			const lines = setup.captureCharFrame().replace(/\n$/, "").split("\n");
			expect(lines).toHaveLength(30);
			for (const line of lines) expect([...line]).toHaveLength(100);

			const gpuRows = lines.filter((line) => line.includes("GPU Offload"));
			expect(gpuRows).toHaveLength(1);
			expect(gpuRows[0]).toContain("GPU Offload");
			expect(
				lines.filter(
					(line) => line.includes("4096") && line.includes("131072"),
				),
			).toHaveLength(1);
		} finally {
			await teardownWithAct(setup);
		}
	});

	it("shows focus movement between GPU Offload and Context Length", async () => {
		const setup = await renderWithAct(configurator(), {
			width: 140,
			height: 40,
		});
		try {
			const initial = setup.captureCharFrame();
			await act(async () => {
				await setup.mockInput.pressKeys(["\x1b[B"]);
			});
			await act(async () => {
				await setup.flush();
			});
			const afterDown = setup.captureCharFrame();

			expect(initial).toContain("> GPU Offload");
			expect(afterDown).toContain("> Context Length");
			expect(afterDown).not.toContain("> GPU Offload");
		} finally {
			await teardownWithAct(setup);
		}
	});
});
