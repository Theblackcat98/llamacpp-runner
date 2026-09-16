import { afterEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, useRef, useState } from "react";
import {
	type ConfiguratorState,
	createConfigurator,
} from "../../src/ui/logic/configurator-state";
import { Configurator } from "../../src/ui/screens/configurator";
import { TOKYO_NIGHT } from "../../src/ui/themes";

const setups: { renderer: { destroy: () => void } }[] = [];
afterEach(async () => {
	for (const s of setups.splice(0)) {
		await act(async () => {
			s.renderer.destroy();
		});
	}
});

const MODEL = {
	path: "~/models/qwen.gguf",
	blockCount: 32,
	contextLength: 32768,
	fileSize: 4 * 1024 ** 3,
	headCount: 32,
	headCountKv: 8,
	embeddingLength: 4096,
};

/**
 * Issue #37: mounting the Configurator with the exact main.tsx wiring
 * (`setState: (next) => setConfig(next)`) started an unbounded
 * render/CPU/RAM storm — each render minted new inline onChange arrows,
 * each TextInput echoed state back through a mount/identity effect, and
 * each echo minted a new state object via setFlag. The guard below turns
 * that storm into a fast deterministic failure instead of a hung test.
 */
const RENDER_BUDGET = 25;

function LiveShell({
	onConfig,
}: {
	onConfig?: (s: ConfiguratorState) => void;
}) {
	const [state, setState] = useState(() => createConfigurator(MODEL));
	const renders = useRef(0);
	renders.current += 1;
	if (renders.current > RENDER_BUDGET) {
		throw new Error(
			`render storm: Configurator exceeded ${RENDER_BUDGET} renders with no input (#37)`,
		);
	}
	return (
		<Configurator
			theme={TOKYO_NIGHT}
			state={state}
			onChange={(next) => {
				onConfig?.(next);
				setState(next);
			}}
			focused
		/>
	);
}

describe("configurator render stability (#37)", () => {
	it("emits no onChange on mount or re-render without input", async () => {
		const seen: ConfiguratorState[] = [];
		const setup = await testRender(
			<Configurator
				theme={TOKYO_NIGHT}
				state={createConfigurator(MODEL)}
				onChange={(next) => {
					seen.push(next);
				}}
				focused
			/>,
			{ width: 120, height: 40 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		await act(async () => {
			await setup.flush();
		});
		expect(seen).toHaveLength(0);
	});

	it("settles after mount with live shell wiring (no render storm)", async () => {
		let changes = 0;
		const setup = await testRender(
			<LiveShell
				onConfig={() => {
					changes += 1;
				}}
			/>,
			{ width: 120, height: 40 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		await act(async () => {
			await setup.flush();
		});
		expect(changes).toBe(0);
	});

	it("typing digits into the alias field lands in the buffer", async () => {
		let latest: ConfiguratorState | null = null;
		let changes = 0;
		// Unguarded live wiring: the settle test above owns storm detection,
		// so navigation + typing renders must not trip a budget here.
		function TypingShell() {
			const [state, setState] = useState(() => createConfigurator(MODEL));
			return (
				<Configurator
					theme={TOKYO_NIGHT}
					state={state}
					onChange={(next) => {
						changes += 1;
						latest = next;
						setState(next);
					}}
					focused
				/>
			);
		}
		const setup = await testRender(<TypingShell />, { width: 120, height: 40 });
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		// Field 0 -> 14 (alias): Down through sliders, chips, selects, bools.
		for (let i = 0; i < 14; i++) {
			await act(async () => {
				await setup.mockInput.pressKeys(["\x1b[B"]);
			});
		}
		await act(async () => {
			await setup.flush();
		});
		await act(async () => {
			await setup.mockInput.pressKeys(["1", "2", "3", "4"]);
		});
		await act(async () => {
			await setup.flush();
		});
		expect(latest).not.toBeNull();
		expect((latest as ConfiguratorState | null)?.values.alias).toBe("1234");
		expect(changes).toBeGreaterThan(0);
	});
});
