/**
 * Issue #70 pin tests: behavior that must stay green across the SessionApp
 * decomposition (green-to-green refactor). Written against UNMODIFIED main
 * first — every case here passed before a single hook was extracted:
 *
 *   1. save → Presets visibility (state + disk agree immediately)
 *   2. preset load restores the saved model into the configurator/plan
 *   3. rescan reconciliation: a newly added model joins the library while
 *      the configured model is left untouched
 *   4. failure transitions: a launch with no binary lands on FAILED in the
 *      header, and the shell stays responsive afterwards
 */
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { act } from "react";
import { loadPresets, presetsFilePath } from "../src/core/store/presets";
import { bootCompositionApp, waitForFrame } from "./composition-harness";
import { sampleLlamaQ4Km, writeFixture } from "./fixtures/gguf/build";

describe("issue #70 pins — save / load / rescan / failure", () => {
	it("save → the Presets tab lists the preset in the same session", async () => {
		const app = await bootCompositionApp({});
		try {
			await waitForFrame(app, (f) => f.includes("alpha.gguf"));

			await app.press(["2"]);
			await act(async () => {
				app.setup.mockInput.pressKey("s", { ctrl: true });
				await app.setup.flush();
			});
			// Audit Tier 2: Ctrl+S prompts for a name first; Enter accepts
			// the blank (timestamp) name and saves.
			await waitForFrame(app, (f) => f.includes("Save preset"));
			await app.press(["\r"]);
			await waitForFrame(app, (f) => f.includes("preset saved"));

			await app.press(["4"]);
			const frame = await waitForFrame(
				app,
				(f) => f.includes("alpha.gguf") && f.includes("(saved"),
				3000,
			);
			expect(frame).toContain("alpha.gguf");

			const store = loadPresets(
				presetsFilePath(join(app.scratch, "config", "llama-deck")),
			);
			expect(store.data?.presets.length).toBe(1);
			expect(store.data?.lastSession?.preset_id).toBe(
				store.data?.presets[0]?.id,
			);
		} finally {
			await app.dispose();
		}
	}, 20000);

	it("preset load restores the saved model into the launch plan", async () => {
		const app = await bootCompositionApp({});
		try {
			await waitForFrame(app, (f) => f.includes("alpha.gguf"));
			const alpha = join(app.modelsDir, "alpha.gguf");
			const beta = join(app.modelsDir, "beta.gguf");

			// Configure beta and save it as a preset.
			await app.press(["\x1b[B"]);
			expect(app.planSource.current?.()?.args[1]).toBe(beta);
			await app.press(["2"]);
			await act(async () => {
				app.setup.mockInput.pressKey("s", { ctrl: true });
				await app.setup.flush();
			});
			// Audit Tier 2: Ctrl+S prompts for a name first; Enter accepts
			// the blank (timestamp) name and saves.
			await waitForFrame(app, (f) => f.includes("Save preset"));
			await app.press(["\r"]);
			await waitForFrame(app, (f) => f.includes("preset saved"));

			// Move the configurator back to alpha via the Explorer. The
			// table remounts on tab switch with its cursor at row 0 while
			// the shell's selectedIndex still points at beta, so a j→k
			// pair re-syncs the cursor (j re-selects beta) then moves up.
			await app.press(["1"]);
			for (
				let i = 0;
				i < 4 && app.planSource.current?.()?.args[1] !== alpha;
				i++
			) {
				await app.press(["j"]);
				await app.press(["k"]);
			}
			expect(app.planSource.current?.()?.args[1]).toBe(alpha);

			// Load the preset from the Presets tab: plan follows the preset.
			await app.press(["4"]);
			await waitForFrame(app, (f) => f.includes("(saved"));
			await app.press(["l"]);
			expect(app.frame()).toContain("Launch config");
			expect(app.planSource.current?.()?.args[1]).toBe(beta);
		} finally {
			await app.dispose();
		}
	}, 20000);

	it("rescan reconciliation: new model joins, configured model untouched", async () => {
		const app = await bootCompositionApp({});
		try {
			await waitForFrame(
				app,
				(f) => f.includes("alpha.gguf") && f.includes("beta.gguf"),
			);
			const beta = join(app.modelsDir, "beta.gguf");

			// Configure beta.
			await app.press(["\x1b[B"]);
			expect(app.planSource.current?.()?.args[1]).toBe(beta);

			// A new model lands in the directory; rescan via [r].
			writeFixture(app.modelsDir, "gamma.gguf", sampleLlamaQ4Km().buffer);
			await app.press(["r"]);

			const frame = await waitForFrame(
				app,
				(f) => f.includes("gamma.gguf"),
				8000,
			);
			expect(frame).toContain("beta.gguf");
			// Reconciliation must not steal the configurator from beta.
			expect(app.planSource.current?.()?.args[1]).toBe(beta);
		} finally {
			await app.dispose();
		}
	}, 20000);

	it("failure transition: missing binary → header FAILED, shell responsive", async () => {
		const app = await bootCompositionApp({});
		try {
			await waitForFrame(app, (f) => f.includes("alpha.gguf"));
			expect(app.frame()).not.toContain("server failed");

			// Launch: no llama-server binary exists in the test env, so the
			// supervisor fails fast and PROC_STATE lands on FAILED.
			// Audit Tier 1 #6: Enter on the Explorer navigates to Launch
			// Config instead of launching — Enter there launches.
			await app.press(["\r"]);
			expect(app.frame()).toContain("Launch config");
			await app.press(["\r"]);
			const frame = await waitForFrame(
				app,
				(f) => f.includes("server failed"),
				8000,
			);
			expect(frame).toContain("server failed");
			expect(frame).not.toContain("server running");

			// The shell stays responsive after the failure transition.
			await app.press(["2"]);
			expect(app.frame()).toContain("Launch config");
			await app.press(["1"]);
			expect(app.frame()).toContain("alpha.gguf");
		} finally {
			await app.dispose();
		}
	}, 20000);
});
