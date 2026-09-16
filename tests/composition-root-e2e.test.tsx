/**
 * Composition-root E2E (Issue #31): the tests that would have caught the
 * 2026-09-15 walkthrough bugs (boot state loss, MODELS_DIR re-emit,
 * selection wipe). They drive the REAL SessionApp wiring — session.boot →
 * modelsService → bus intents/state → screens — with keys pressed through
 * the harness exactly like the golden tests do. No hand-fed props.
 */
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { bootCompositionApp, waitForFrame } from "./composition-harness";

describe("composition root E2E (Issue #31)", () => {
	it("welcome → set dir via keyboard → table renders N rows", async () => {
		const app = await bootCompositionApp({ configureDir: false });
		try {
			// Boot state: no models dir → WELCOME panel, not the table.
			expect(app.frame()).toContain("No model directory configured yet");

			// [m] opens the directory prompt (real key event, real wiring).
			await app.press(["m"]);
			expect(app.frame()).toContain("Enter model directory path");

			// Type the path and confirm — the models service scans it.
			await app.press(app.modelsDir.split(""));
			await app.press(["\r"]);

			const frame = await waitForFrame(
				app,
				(f) => f.includes("alpha.gguf") && f.includes("beta.gguf"),
			);
			expect(frame).not.toContain("No model directory configured yet");
		} finally {
			await app.dispose();
		}
	});

	it("arrow-key selection populates the configurator; preview matches", async () => {
		const app = await bootCompositionApp({});
		try {
			await waitForFrame(
				app,
				(f) => f.includes("alpha.gguf") && f.includes("beta.gguf"),
			);

			// The composition auto-selects the first healthy model on scan:
			// the configurator's live plan resolver reflects it.
			const alpha = join(app.modelsDir, "alpha.gguf");
			const beta = join(app.modelsDir, "beta.gguf");
			expect(app.planSource.current?.()?.args[1]).toBe(alpha);

			// Down-arrow through the real table → MODELS_STATE →
			// selectModelFromEntries → configurator state → plan.
			await app.press(["\x1b[B"]);
			expect(app.planSource.current?.()?.args[1]).toBe(beta);

			// The explorer's quick-launch preview follows the same selection.
			const frame = app.frame();
			expect(frame).toContain("llama-server -m");
			expect(frame).toContain("beta.gguf");

			// And back up.
			await app.press(["\x1b[A"]);
			expect(app.planSource.current?.()?.args[1]).toBe(alpha);
		} finally {
			await app.dispose();
		}
	});

	it("the dir editor does not leak table navigation keys", async () => {
		const app = await bootCompositionApp({});
		try {
			await waitForFrame(app, (f) => f.includes("alpha.gguf"));
			const before = app.planSource.current?.()?.args[1];

			// Open the dir prompt, then press "j" (table's vim-down). The
			// table must not see it while the editor owns the keyboard —
			// otherwise selection (and the configurator) silently moves.
			await app.press(["m"]);
			await app.press(["j"]);
			await app.press(["\x1b"]); // escape: cancel, keep the old dir

			expect(app.planSource.current?.()?.args[1]).toBe(before);
			expect(app.frame()).toContain("alpha.gguf");
		} finally {
			await app.dispose();
		}
	});
});
