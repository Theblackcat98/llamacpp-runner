import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { App } from "../../src/ui/app";
import { DEFAULT_THEME } from "../../src/ui/themes";

async function flush(setup: { flush: () => Promise<void> }) {
	await setup.flush();
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
			setup.renderer.destroy();
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
			setup.renderer.destroy();
		}
	});

	it("growing back above the minimum restores the shell", async () => {
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
			await flush(setup);
			const frame = setup.captureCharFrame();
			expect(frame).toContain("Model Explorer");
			expect(frame).not.toContain("Resize");
		} finally {
			setup.renderer.destroy();
		}
	});

	it("shrinking below the minimum activates degraded mode", async () => {
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
			await flush(setup);
			const frame = setup.captureCharFrame();
			expect(frame).toContain("Resize");
			expect(frame).not.toContain("Model Explorer");
		} finally {
			setup.renderer.destroy();
		}
	});
});
