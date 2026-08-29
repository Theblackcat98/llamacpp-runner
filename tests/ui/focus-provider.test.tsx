import { afterEach, describe, expect, it } from "bun:test";
import { useKeyboard } from "@opentui/react";
import { testRender } from "@opentui/react/test-utils";
import { act, useState } from "react";
import {
	FocusProvider,
	useFocus,
	useInputCapture,
} from "../../src/ui/focus/provider";

const setups: { renderer: { destroy: () => void } }[] = [];
afterEach(async () => {
	for (const s of setups.splice(0)) {
		await act(async () => {
			s.renderer.destroy();
		});
	}
});

function FakeTable() {
	const { focused } = useFocus("table");
	const [pos, setPos] = useState(0);
	const [label, setLabel] = useState("table");
	useKeyboard((key) => {
		if (!focused) return;
		if (key.name === "j") setPos((p) => p + 1);
		if (key.name === "k") setLabel("table-k");
	});
	return <text>{`${label}:${pos}`}</text>;
}

function FakeInput() {
	const { focused } = useFocus("input");
	const [buf, setBuf] = useState("");
	useInputCapture("input", (key) => {
		setBuf((b) => b + (key.name ?? ""));
	});
	return <text>{`${focused ? "*" : ""}in<${buf}>`}</text>;
}

describe("focus provider (P2-FR-13)", () => {
	it("typing j in an input does not move the table", async () => {
		const setup = await testRender(
			<FocusProvider order={["input", "table"]}>
				<FakeInput />
				<FakeTable />
			</FocusProvider>,
			{ width: 40, height: 3 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.flush();
		});
		let frame = setup.captureCharFrame();
		expect(frame).toContain("in<>");

		await act(async () => {
			await setup.mockInput.pressKeys(["j"]);
		});
		await act(async () => {
			await setup.flush();
		});
		frame = setup.captureCharFrame();
		expect(frame).toContain("in<j>");
		expect(frame).toContain("table:0");

		await act(async () => {
			await setup.mockInput.pressKeys(["\x1b"]);
		});
		// lone ESC is held by OpenTUI's escape-disambiguation timer; let it flush
		await new Promise((r) => setTimeout(r, 120));
		await act(async () => {
			await setup.mockInput.pressKeys(["\t"]);
		});
		await act(async () => {
			await setup.mockInput.pressKeys(["j"]);
		});
		await act(async () => {
			await setup.flush();
		});
		frame = setup.captureCharFrame();
		expect(frame).toContain("table:1");
	});

	it("Tab cycles focus between panes", async () => {
		const setup = await testRender(
			<FocusProvider order={["input", "table"]}>
				<FakeInput />
				<FakeTable />
			</FocusProvider>,
			{ width: 40, height: 3 },
		);
		setups.push(setup);
		await act(async () => {
			await setup.mockInput.pressKeys(["\t"]);
		});
		await act(async () => {
			await setup.flush();
		});
		expect(setup.captureCharFrame()).toContain("table:0");
	});
});
