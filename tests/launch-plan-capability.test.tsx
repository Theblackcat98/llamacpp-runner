/**
 * Issue #15 regression: TUI launch/preview path must be capability-aware.
 *
 * One resolved LaunchPlan is the source of truth: the TUI resolves the
 * actual binary (configured binary_path or PATH), captures its --help,
 * derives registry availability, and feeds the same capability-aware plan
 * to BOTH the preview strip and the launch resolver. Preview argv must
 * equal launched argv — they must not be allowed to diverge.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { bootCompositionApp, waitForFrame } from "./composition-harness";

const PROJECT_ROOT = join(import.meta.dir, "..");
const REDUCED_BIN = join(PROJECT_ROOT, "tests/fixtures/help/reduced-help.sh");
const REDUCED_ARGV = `${REDUCED_BIN}.argv`;

describe("TUI launch plan capability validation (issue #15)", () => {
	it("launch plan resolves the configured binary and filters unsupported flags", async () => {
		const app = await bootCompositionApp({});
		try {
			await waitForFrame(app, (f) => f.includes("alpha.gguf"));
			// Default PATH resolution: plan still works, argv starts with -m model.
			const plan = app.planSource.current?.() ?? null;
			expect(plan).not.toBeNull();
			expect(plan?.args[0]).toBe("-m");
		} finally {
			await app.dispose();
		}
	});

	it("preview argv == launched argv for a custom binary with a reduced flag set", async () => {
		// Configure the file-level binary_path through the same harness path
		// production uses, then remove any stale launch record.
		rmSync(REDUCED_ARGV, { force: true });
		const app = await bootCompositionApp({ configuredBinary: REDUCED_BIN });
		try {
			await waitForFrame(app, (f) => f.includes("alpha.gguf"));

			// The resolver's command is the RESOLVED custom binary, not the
			// constant and not the raw configured path (resolved as given).
			const plan = app.planSource.current?.() ?? null;
			if (!plan) throw new Error("expected a launch plan");
			expect(plan.command).toBe(REDUCED_BIN);

			// n_gpu_layers is unsupported by the reduced binary -> dropped
			// from the actual argv even though the configurator sets it.
			expect(plan?.args).not.toContain("-ngl");
			// --mlock is not advertised either — absent from argv.
			expect(plan?.args).not.toContain("--mlock");
			// Supported flags survive.
			expect(plan?.args).toContain("--port");
			// Telemetry pair is unsupported by the reduced binary -> dropped.
			expect(plan?.args).not.toContain("--slots");
			expect(plan?.args).not.toContain("--metrics");

			// The configurator preview strip shows the SAME binary path and
			// capability-filtered argv that launch will execute.
			await app.press(["2"]); // switch to the Configurator tab
			const frame = await waitForFrame(app, (f) =>
				f.includes("Quick launch command preview"),
			);
			expect(frame).toContain(REDUCED_BIN);
			expect(frame).not.toContain("-ngl");

			// Launch the real composition and compare the fake binary's received
			// argv with the plan rendered above. This proves preview and execution
			// share the same capability-filtered plan.
			await act(async () => {
				app.bus.emitIntent("LAUNCH", { presetId: "ad-hoc" });
			});
			await waitForFrame(app, (f) => f.includes("server is listening"));
			const launchedArgs = readFileSync(REDUCED_ARGV, "utf8")
				.trim()
				.split("\n");
			expect(launchedArgs).toEqual(plan.args);
		} finally {
			await app.dispose();
			rmSync(REDUCED_ARGV, { force: true });
		}
	}, 15_000);

	it("missing/help-capture-failure surfaces unverified status instead of silently validating", async () => {
		const app = await bootCompositionApp({
			configuredBinary: "/no/such/binary-issue15",
		});
		try {
			await waitForFrame(app, (f) => f.includes("alpha.gguf"));
			// The unverified state must be surfaced in the console log, never
			// presented as validated.
			const frame = await waitForFrame(
				app,
				(f) => f.includes("binary") && f.includes("unverified"),
			);
			expect(frame).toContain("unverified");
		} finally {
			await app.dispose();
		}
	});
});
