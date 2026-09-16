/**
 * #54: real-terminal black-box smoke flows. Drives the actual TUI binary
 * through tmux (real pty, real key delivery timing) — the seam in-process
 * virtual-renderer tests cannot see (the #25/#26 regression class).
 *
 * tmux is a documented dev requirement; the suite names its skip reason
 * when tmux is absent. Non-goals honored: no kitty/ghostty rows here.
 */
import { afterAll, describe, expect, it } from "bun:test";
import {
	launchTui,
	shutdownAndCheckOrphans,
	tmuxVersion,
	waitForPane,
} from "./tui-harness";

const HAS_TMUX = tmuxVersion() !== null;
if (!HAS_TMUX) {
	console.log(
		"[skip reason #54] tmux is not installed — real-terminal smoke flows skipped (install tmux to run them)",
	);
}
const itWithTmux = HAS_TMUX ? it : it.skip;

const BOOT_TIMEOUT = 20_000;

describe("tmux real-terminal smoke flows (#54)", () => {
	const liveSessions: ReturnType<typeof launchTui>[] = [];

	afterAll(() => {
		for (const session of liveSessions.splice(0)) session.dispose();
	});

	itWithTmux(
		"boot smoke: fixture catalog rows render in a real pty, q quits clean, no orphans",
		async () => {
			const session = launchTui({
				name: "boot-smoke",
				width: 120,
				height: 40,
			});
			liveSessions.push(session);
			try {
				const frame = await waitForPane(
					"boot-smoke",
					session,
					(f) => f.includes("alpha.gguf") && f.includes("beta.gguf"),
					"fixture catalog rows to appear",
					BOOT_TIMEOUT,
				);
				expect(frame).toContain("llama-deck v0.1.0");
				await shutdownAndCheckOrphans("boot-smoke", session);
			} finally {
				session.dispose();
			}
		},
		45_000,
	);

	itWithTmux(
		"mixed-case input: capitals survive real key delivery end-to-end (#26 class)",
		async () => {
			const session = launchTui({
				name: "mixed-case",
				width: 120,
				height: 40,
			});
			liveSessions.push(session);
			try {
				await waitForPane(
					"mixed-case",
					session,
					(f) => f.includes("alpha.gguf"),
					"app boot",
					BOOT_TIMEOUT,
				);
				// Tab 4 = Presets (0-indexed constants: PRESETS_TAB=3) ->
				// [i] opens the shell-command import modal.
				session.key("4");
				session.key("i");
				await waitForPane(
					"mixed-case",
					session,
					(f) => f.includes("Import shell command"),
					"import modal to open",
					BOOT_TIMEOUT,
				);
				const typed = "llama-server -m ~/Models/MiXeD/QwErTy.gguf -c 4096";
				session.type(typed);
				const frame = await waitForPane(
					"mixed-case",
					session,
					(f) => f.includes("MiXeD/QwErTy.gguf"),
					"mixed-case path to be echoed by the input",
					BOOT_TIMEOUT,
				);
				expect(frame).toContain("~/Models/MiXeD/QwErTy.gguf");
				session.key("Escape");
				// Wait for the modal to close before quitting — q must reach
				// the shell, not the modal's text input.
				await waitForPane(
					"mixed-case",
					session,
					(f) => !f.includes("Import shell command"),
					"the import modal to close",
					BOOT_TIMEOUT,
				);
				await shutdownAndCheckOrphans("mixed-case", session);
			} finally {
				session.dispose();
			}
		},
		60_000,
	);

	itWithTmux(
		"viewport matrix: below 100x30 degrades to the resize hint, at/above renders the shell",
		async () => {
			const matrix = [
				{ width: 80, height: 24, degraded: true },
				{ width: 99, height: 29, degraded: true },
				{ width: 100, height: 30, degraded: false },
				{ width: 120, height: 40, degraded: false },
			];
			for (const { width, height, degraded } of matrix) {
				const label = `viewport-${width}x${height}`;
				const session = launchTui({
					name: label,
					width,
					height,
				});
				try {
					if (degraded) {
						const frame = await waitForPane(
							label,
							session,
							(f) => f.includes("Resize to at least 100x30"),
							"the degraded resize hint",
							BOOT_TIMEOUT,
						);
						expect(frame).toContain("Terminal too small");
					} else {
						const frame = await waitForPane(
							label,
							session,
							(f) => f.includes("llama-deck v0.1.0"),
							"the full shell header",
							BOOT_TIMEOUT,
						);
						expect(frame).not.toContain("Terminal too small");
					}
				} finally {
					session.dispose();
				}
			}
		},
		90_000,
	);
});
