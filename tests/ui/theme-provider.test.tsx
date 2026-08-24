import { afterEach, describe, expect, it } from "bun:test";
import { useKeyboard } from "@opentui/react";
import { testRender } from "@opentui/react/test-utils";
import { act, useState } from "react";
import {
	cycleTheme,
	ThemeProvider,
	useTheme,
} from "../../src/ui/themes/provider";

const setups: { renderer: { destroy: () => void } }[] = [];
afterEach(() => {
	for (const s of setups.splice(0)) s.renderer.destroy();
});

function Probe() {
	const { theme, setTheme } = useTheme();
	const [n, setN] = useState(0);
	useKeyboard((key) => {
		if (key.name === "t") {
			setTheme(cycleTheme(theme.name));
			setN((x) => x + 1);
		}
	});
	return <text fg={theme.accent}>{`${theme.name}#${n}`}</text>;
}

describe("theme provider runtime switch (P2-FR-14)", () => {
	it("re-renders consumers with the next palette on the fly", async () => {
		const setup = await testRender(
			<ThemeProvider initial="TokyoNight">
				<Probe />
			</ThemeProvider>,
			{ width: 40, height: 3 },
		);
		setups.push(setup);
		await setup.flush();
		expect(setup.captureCharFrame()).toContain("TokyoNight#0");

		await act(async () => {
			await setup.mockInput.pressKeys(["t"]);
		});
		await setup.flush();
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Catppuccin#1");
		expect(frame).not.toContain("TokyoNight");
	});
});
