import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { App } from "../../src/ui/app";
import { DEFAULT_THEME } from "../../src/ui/themes";

async function flush(setup: { flush: () => Promise<void> }) {
	await act(async () => {
		await setup.flush();
	});
}

/** Let the relayout debounce interval tick inside act so no update escapes. */
async function settle(ms: number): Promise<void> {
	await act(async () => {
		await Bun.sleep(ms);
	});
}

describe("degraded layout (§7, P1-NFR-04)", () => {
	it("below 100x30 renders single-column resize hint instead of the shell", async () => {
		const setup = await testRender(<App theme={DEFAULT_THEME} />, {
			width: 60,
			height: 20,
		});
		try {
			await flush(setup);
			const frame = setup.captureCharFrame();
			expect(frame).toContain("Resize");
			expect(frame).toContain("60x20");
			expect(frame).not.toContain("Model Explorer");
			expect(frame).not.toContain("[Enter] Launch");
		} finally {
			await act(async () => {
				setup.renderer.destroy();
			});
		}
	});

	it("at 100x30 renders the normal shell", async () => {
		const setup = await testRender(<App theme={DEFAULT_THEME} />, {
			width: 100,
			height: 30,
		});
		try {
			await flush(setup);
			const frame = setup.captureCharFrame();
			expect(frame).toContain("Model Explorer");
			expect(frame).not.toContain("Resize");
		} finally {
			await act(async () => {
				setup.renderer.destroy();
			});
		}
	});

	it("growing back above the minimum restores the shell after settle", async () => {
		const setup = await testRender(<App theme={DEFAULT_THEME} />, {
			width: 60,
			height: 20,
		});
		try {
			await flush(setup);
			expect(setup.captureCharFrame()).toContain("Resize");
			await act(async () => {
				await setup.resize(120, 40);
			});
			await settle(260); // debounce (120 ms) + settle poll
			await flush(setup);
			const frame = setup.captureCharFrame();
			expect(frame).toContain("Model Explorer");
			expect(frame).not.toContain("Resize");
		} finally {
			await act(async () => {
				setup.renderer.destroy();
			});
		}
	});

	it("shrinking below the minimum activates degraded mode after settle", async () => {
		const setup = await testRender(<App theme={DEFAULT_THEME} />, {
			width: 120,
			height: 40,
		});
		try {
			await flush(setup);
			expect(setup.captureCharFrame()).toContain("Model Explorer");
			await act(async () => {
				await setup.resize(50, 15);
			});
			await settle(260);
			await flush(setup);
			const frame = setup.captureCharFrame();
			expect(frame).toContain("Resize");
			expect(frame).not.toContain("Model Explorer");
		} finally {
			await act(async () => {
				setup.renderer.destroy();
			});
		}
	});

	it("resize churn commits only the final dimensions (P5-FR-14)", async () => {
		const setup = await testRender(<App theme={DEFAULT_THEME} />, {
			width: 100,
			height: 30,
		});
		try {
			await flush(setup);
			for (const [w, h] of [
				[110, 32],
				[115, 34],
				[125, 36],
			] as const) {
				await act(async () => {
					await setup.resize(w, h);
				});
			}
			await settle(300);
			await flush(setup);
			const frame = setup.captureCharFrame();
			expect(frame).toContain("Model Explorer");
			expect(frame).not.toContain("Resize");
		} finally {
			await act(async () => {
				setup.renderer.destroy();
			});
		}
	});
});
