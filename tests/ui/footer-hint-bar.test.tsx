import { describe, expect, it } from "bun:test";
import { FooterHintBar } from "../../src/ui/components/footer-hint-bar";
import { DEFAULT_THEME } from "../../src/ui/themes";
import { renderWithAct, teardownWithAct } from "./golden/harness";

describe("FooterHintBar (#48)", () => {
	it("renders borderless — no box glyphs anywhere in the footer", async () => {
		const setup = await renderWithAct(
			<FooterHintBar theme={DEFAULT_THEME} tab={0} width={100} notice={null} />,
			{ width: 100, height: 3 },
		);
		const frame = setup.captureCharFrame();
		await teardownWithAct(setup);
		expect(frame).toContain("[?]");
		expect(frame).not.toMatch(/[┌┐└┘─│]/);
	});

	it("shows contextual hints per tab", async () => {
		for (const [tab, marker] of [
			[0, "[m]"],
			[1, "[Ctrl+S]"],
			[3, "[l]"],
		] as const) {
			const setup = await renderWithAct(
				<FooterHintBar
					theme={DEFAULT_THEME}
					tab={tab}
					width={100}
					notice={null}
				/>,
				{ width: 100, height: 3 },
			);
			const frame = setup.captureCharFrame();
			await teardownWithAct(setup);
			expect(frame).toContain(marker);
		}
	});

	it("never wraps: every rendered line fits the width", async () => {
		const setup = await renderWithAct(
			<FooterHintBar theme={DEFAULT_THEME} tab={0} width={40} notice={null} />,
			{ width: 40, height: 5 },
		);
		const frame = setup.captureCharFrame();
		await teardownWithAct(setup);
		for (const line of frame.split("\n")) {
			expect(line.length).toBeLessThanOrEqual(40);
		}
		expect(frame).toContain("[Tab]");
	});

	it("a confirm notice replaces the hints", async () => {
		const setup = await renderWithAct(
			<FooterHintBar
				theme={DEFAULT_THEME}
				tab={0}
				width={100}
				notice="press [q] again to quit"
			/>,
			{ width: 100, height: 3 },
		);
		const frame = setup.captureCharFrame();
		await teardownWithAct(setup);
		expect(frame).toContain("press [q] again to quit");
		expect(frame).not.toContain("[1-4]");
	});
});
