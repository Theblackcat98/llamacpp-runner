import { afterEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, useState } from "react";
import type { ModelEntry } from "../../src/core/models/types";
import { Explorer } from "../../src/ui/screens/explorer";
import { TOKYO_NIGHT } from "../../src/ui/themes";

const setups: { renderer: { destroy: () => void } }[] = [];
afterEach(async () => {
	for (const s of setups.splice(0)) {
		await act(async () => {
			s.renderer.destroy();
		});
	}
});

function entry(
	name: string,
	totalBytes: number,
	contextLength: number,
): ModelEntry {
	return {
		name,
		path: `/models/${name}`,
		paths: [`/models/${name}`],
		totalBytes,
		architecture: "llama",
		quantName: "Q4_K_M",
		contextLength,
		blockCount: 32,
		embeddingLength: 4096,
		headCount: 32,
		headCountKv: 8,
	};
}

const ENTRIES: ModelEntry[] = [
	entry("alpha.gguf", 1000, 4096),
	entry("beta.gguf", 9000, 8192),
	entry("gamma.gguf", 5000, 32768),
];

async function renderExplorer(
	props: Partial<Parameters<typeof Explorer>[0]> = {},
) {
	const setup = await testRender(
		<Explorer
			theme={TOKYO_NIGHT}
			entries={ENTRIES}
			modelsDir="/models"
			focused
			{...props}
		/>,
		{ width: 110, height: 26 },
	);
	setups.push(setup);
	await act(async () => {
		await setup.flush();
	});
	return setup;
}

async function press(
	setup: Awaited<ReturnType<typeof testRender>>,
	keys: string[],
): Promise<void> {
	await act(async () => {
		await setup.mockInput.pressKeys(keys);
	});
	await act(async () => {
		await setup.flush();
	});
}

/** Lone ESC is held by OpenTUI's escape-disambiguation timer. */
async function pressEscape(
	setup: Awaited<ReturnType<typeof testRender>>,
): Promise<void> {
	await act(async () => {
		await setup.mockInput.pressKeys(["\x1b"]);
	});
	await act(async () => {
		await new Promise((r) => setTimeout(r, 120));
		await setup.flush();
	});
}

/** Row of a model in the TABLE (inspector/preview also name the file;
 * table rows are the ones carrying the size column). */
function rowOf(frame: string, needle: string): number {
	return frame
		.split("\n")
		.findIndex((l) => l.includes(needle) && l.includes("MiB"));
}

describe("explorer filter (Tier 3)", () => {
	it("/ narrows the table by fuzzy filename match; Esc clears", async () => {
		const setup = await renderExplorer();
		await press(setup, ["/", "a", "l", "p"]);
		let frame = setup.captureCharFrame();
		expect(frame).toContain("/alp_");
		expect(frame).toContain("alpha.gguf");
		expect(frame).not.toContain("beta.gguf");
		expect(frame).not.toContain("gamma.gguf");
		expect(frame).toContain("1/3 models");

		await pressEscape(setup);
		frame = setup.captureCharFrame();
		expect(frame).toContain("beta.gguf");
		expect(frame).toContain("gamma.gguf");
		expect(frame).not.toContain("/alp_");
	});

	it("Enter keeps the filter while exiting filter mode", async () => {
		const setup = await renderExplorer();
		await press(setup, ["/", "g", "a", "m", "\r"]);
		const frame = setup.captureCharFrame();
		expect(frame).toContain('filter: "gam"');
		expect(frame).toContain("gamma.gguf");
		expect(frame).not.toContain("alpha.gguf");
	});

	it("selection tracks model identity across filtering, not row index", async () => {
		const setup = await renderExplorer();
		// Name order: alpha(0), beta(1), gamma(2). Move to beta.
		await press(setup, ["j"]);
		expect(setup.captureCharFrame()).toContain(
			"llama-server -m /models/beta.gguf",
		);
		// Filter down to beta only: the inspector/preview stay on beta
		// even though its row index changed 1 -> 0.
		await press(setup, ["/", "b", "e", "t", "\r"]);
		let frame = setup.captureCharFrame();
		expect(frame).toContain("llama-server -m /models/beta.gguf");
		// Clear the filter: cursor is still on beta (row 1), not on the
		// model that inherited index 0 while filtered.
		await press(setup, ["/"]);
		await pressEscape(setup);
		frame = setup.captureCharFrame();
		expect(frame).toContain("llama-server -m /models/beta.gguf");
	});

	it("typing in filter mode does not re-select the same model upstream", async () => {
		const calls: number[] = [];
		function Harness() {
			const [sel, setSel] = useState(0);
			return (
				<Explorer
					theme={TOKYO_NIGHT}
					entries={ENTRIES}
					modelsDir="/models"
					focused
					selectedIndex={sel}
					onSelectIndex={(i) => {
						calls.push(i);
						setSel(i);
					}}
				/>
			);
		}
		const setup = await testRender(<Harness />, { width: 110, height: 26 });
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		await press(setup, ["j"]);
		expect(calls).toEqual([1]);
		await press(setup, ["/", "b", "e", "t"]);
		// No further upstream selection: identity never changed.
		expect(calls).toEqual([1]);
	});

	it("arrows navigate while filtering; j/k type into the query", async () => {
		const setup = await renderExplorer();
		await press(setup, ["/", "a"]);
		// All three names contain "a"; fuzzy rank orders the view
		// alpha, gamma, beta. Down moves to the second row (gamma) even
		// while the filter owns the keyboard.
		await press(setup, ["\x1b[B"]);
		expect(setup.captureCharFrame()).toContain(
			"llama-server -m /models/gamma.gguf",
		);
		await press(setup, ["j"]);
		expect(setup.captureCharFrame()).toContain("/aj_");
	});
});

describe("explorer sort (Tier 3)", () => {
	it("s cycles name -> size -> context -> scan and reorders rows", async () => {
		const setup = await renderExplorer();
		let frame = setup.captureCharFrame();
		expect(frame).not.toContain("sort:");
		expect(rowOf(frame, "alpha.gguf")).toBeLessThan(rowOf(frame, "beta.gguf"));

		await press(setup, ["s"]);
		frame = setup.captureCharFrame();
		expect(frame).toContain("sort: Name");
		expect(rowOf(frame, "alpha.gguf")).toBeLessThan(rowOf(frame, "beta.gguf"));

		await press(setup, ["s"]);
		frame = setup.captureCharFrame();
		expect(frame).toContain("sort: Size");
		// Size descending: beta(9000), gamma(5000), alpha(1000).
		expect(rowOf(frame, "beta.gguf")).toBeLessThan(rowOf(frame, "gamma.gguf"));
		expect(rowOf(frame, "gamma.gguf")).toBeLessThan(rowOf(frame, "alpha.gguf"));

		await press(setup, ["s"]);
		frame = setup.captureCharFrame();
		expect(frame).toContain("sort: Context");
		// Context descending: gamma(32768), beta(8192), alpha(4096).
		expect(rowOf(frame, "gamma.gguf")).toBeLessThan(rowOf(frame, "beta.gguf"));
		expect(rowOf(frame, "beta.gguf")).toBeLessThan(rowOf(frame, "alpha.gguf"));

		await press(setup, ["s"]);
		frame = setup.captureCharFrame();
		expect(frame).not.toContain("sort:");
		expect(rowOf(frame, "alpha.gguf")).toBeLessThan(rowOf(frame, "beta.gguf"));
	});

	it("s typed inside the filter edits the query instead of sorting", async () => {
		const setup = await renderExplorer();
		await press(setup, ["/", "s"]);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("/s_");
		expect(frame).not.toContain("sort: Size");
	});
});
