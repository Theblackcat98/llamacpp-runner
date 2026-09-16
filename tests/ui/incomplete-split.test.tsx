import { afterEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import type { ModelEntry } from "../../src/core/models/types";
import { App } from "../../src/ui/app";
import { createConfigurator } from "../../src/ui/logic/configurator-state";
import { DEFAULT_THEME } from "../../src/ui/themes";

/**
 * #18: incomplete split groups are VISIBLY marked and never render as a
 * launch-ready artifact at the App level — the quick-launch preview strip
 * must show the blocked diagnostic instead of a runnable command.
 */

const COMPLETE: ModelEntry = {
	name: "full",
	path: "~/models/full.gguf",
	paths: ["~/models/full.gguf"],
	totalBytes: 20 * 1024 ** 3,
	quantName: "Q4_K_M",
	blockCount: 64,
};

const INCOMPLETE: ModelEntry = {
	...COMPLETE,
	name: "bigmodel",
	path: "~/models/bigmodel-00001-of-00003.gguf",
	paths: ["~/models/bigmodel-00001-of-00003.gguf"],
	incomplete: true,
};

type Setup = Awaited<ReturnType<typeof testRender>>;

const setups: Setup[] = [];
afterEach(async () => {
	for (const s of setups.splice(0)) {
		await act(async () => {
			s.renderer.destroy();
		});
	}
});

async function frameFor(entries: ModelEntry[]): Promise<string> {
	const setup = await testRender(
		<App
			theme={DEFAULT_THEME}
			explorerControl={{
				entries,
				scanning: false,
				modelsDir: "~/models",
				onRescan: () => {},
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
	return setup.captureCharFrame();
}

describe("incomplete split visibility (#18)", () => {
	it("preview strip offers the launch command for a complete model", async () => {
		const frame = await frameFor([COMPLETE]);
		expect(frame).toContain("llama-server -m");
	});

	it("preview strip blocks an incomplete split group", async () => {
		const frame = await frameFor([INCOMPLETE]);
		expect(frame).toContain("incomplete split");
		expect(frame).not.toContain("llama-server -m");
	});

	it("inspector marks the INCOMPLETE SPLIT state", async () => {
		const frame = await frameFor([INCOMPLETE]);
		expect(frame).toContain("INCOMPLETE SPLIT");
		expect(frame).toContain("~ bigmodel");
	});
});
