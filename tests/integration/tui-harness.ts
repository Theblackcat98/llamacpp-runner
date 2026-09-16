/**
 * Black-box TUI test harness (#54): drives the real app inside an isolated
 * tmux server (-L socket, fixed geometry) — real pty, real key delivery —
 * and asserts on captured panes with bounded polling (never fixed sleeps).
 *
 * Evidence (captured frames + key scripts + stderr) is written under
 * .tmp/tui-evidence/<scenario>/ on failure. Teardown verifies the app
 * process is gone and no llama-server orphan survived (§6.2 seam).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sampleLlamaQ4Km } from "../fixtures/gguf/build";

export const EVIDENCE_ROOT = join(process.cwd(), ".tmp", "tui-evidence");

function tmux(socket: string, args: string[]): string {
	const proc = spawnSync("tmux", ["-L", socket, ...args], {
		encoding: "utf8",
	});
	if (proc.status !== 0) {
		throw new Error(
			`tmux ${args.join(" ")} failed: ${proc.stderr || proc.stdout || `status ${proc.status}`}`,
		);
	}
	return proc.stdout;
}

export function tmuxVersion(): string | null {
	const proc = spawnSync("tmux", ["-V"], { encoding: "utf8" });
	return proc.status === 0 ? proc.stdout.trim() : null;
}

export interface TuiScenarioDirs {
	root: string;
	configDir: string;
	stateDir: string;
	modelsDir: string;
}

export interface TuiSession {
	socket: string;
	name: string;
	dirs: TuiScenarioDirs;
	/** Literal text into the pane (tmux send-keys -l). */
	type(text: string): void;
	/** Key names (tmux send-keys, e.g. Enter, Escape, q). */
	key(...names: string[]): void;
	capture(): string;
	paneDead(): boolean;
	/** App process id discovered from the pane process tree. */
	appPid: number | null;
	dispose(): void;
}

export interface LaunchOptions {
	name: string;
	width: number;
	height: number;
	/** Model file names seeded into the isolated models dir. */
	models?: string[];
	/** Extra config.json fields. */
	config?: Record<string, unknown>;
}

/**
 * Launch the TUI in a fresh detached tmux session on an isolated socket.
 * XDG dirs point at a per-scenario scratch root; stderr is teed to
 * .tmp/tui-stderr.log (house rule: scratch lives in project .tmp/).
 */
export function launchTui(opts: LaunchOptions): TuiSession {
	const socket = `tui-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const name = `${opts.name}-${Math.random().toString(36).slice(2, 6)}`;
	const root = join(tmpdir(), `tui-scenario-${name}`);
	const dirs: TuiScenarioDirs = {
		root,
		configDir: join(root, "config"),
		stateDir: join(root, "state"),
		modelsDir: join(root, "models"),
	};
	mkdirSync(join(dirs.configDir, "llama-deck"), { recursive: true });
	mkdirSync(dirs.stateDir, { recursive: true });
	mkdirSync(dirs.modelsDir, { recursive: true });
	mkdirSync(EVIDENCE_ROOT, { recursive: true });
	for (const model of opts.models ?? ["alpha.gguf", "beta.gguf"]) {
		writeFileSync(
			join(dirs.modelsDir, model),
			sampleLlamaQ4Km().buffer as unknown as Uint8Array,
		);
	}
	writeFileSync(
		join(dirs.configDir, "llama-deck", "config.json"),
		JSON.stringify({
			modelsDir: dirs.modelsDir,
			theme: "tokyo-night",
			...opts.config,
		}),
	);

	const stderrLog = join(process.cwd(), ".tmp", "tui-stderr.log");
	const command = `${process.execPath} ${join(process.cwd(), "src", "main.tsx")} 2>>${stderrLog}`;
	tmux(socket, [
		"new-session",
		"-d",
		"-x",
		String(opts.width),
		"-y",
		String(opts.height),
		"-s",
		name,
		"-c",
		process.cwd(),
		"-e",
		`XDG_CONFIG_HOME=${dirs.configDir}`,
		"-e",
		`XDG_STATE_HOME=${dirs.stateDir}`,
		command,
	]);

	const session: TuiSession = {
		socket,
		name,
		dirs,
		appPid: null,
		type(text: string) {
			tmux(socket, ["send-keys", "-t", name, "-l", text]);
		},
		key(...names: string[]) {
			tmux(socket, ["send-keys", "-t", name, ...names]);
		},
		capture(): string {
			return tmux(socket, ["capture-pane", "-t", name, "-p"]);
		},
		paneDead(): boolean {
			try {
				const out = tmux(socket, [
					"list-panes",
					"-t",
					name,
					"-F",
					"#{pane_dead}",
				]).trim();
				// A vanished session means the pane is gone — dead.
				return out === "" || out === "1";
			} catch {
				return true;
			}
		},
		dispose() {
			try {
				tmux(socket, ["kill-session", "-t", name]);
			} catch {
				// already gone
			}
			try {
				// Isolated socket: this server only ever hosts our sessions.
				tmux(socket, ["kill-server"]);
			} catch {
				// already gone
			}
			rmSync(root, { recursive: true, force: true });
		},
	};

	// The pane leader may be a shell wrapping the app; find the bun child.
	discoverAppPid(session);
	return session;
}

function discoverAppPid(session: TuiSession): void {
	const candidates = new Set<number>();
	try {
		const leader = Number(
			spawnSync("tmux", [
				"-L",
				session.socket,
				"list-panes",
				"-t",
				session.name,
				"-F",
				"#{pane_pid}",
			]).stdout.toString(),
		);
		if (Number.isFinite(leader) && leader > 0) candidates.add(leader);
		for (const pid of [...candidates]) {
			const children = spawnSync("ps", ["-o", "pid=", "--ppid", String(pid)]);
			for (const line of (children.stdout.toString() as string).split("\n")) {
				const pid = Number(line.trim());
				if (Number.isFinite(pid) && pid > 0) candidates.add(pid);
			}
		}
	} catch {
		return;
	}
	for (const pid of candidates) {
		const comm = spawnSync("ps", ["-o", "comm=", "-p", String(pid)]);
		if ((comm.stdout.toString() as string).trim().endsWith("bun")) {
			session.appPid = pid;
			return;
		}
	}
}

export function saveEvidence(
	scenario: string,
	session: TuiSession | null,
	detail: string,
): void {
	const dir = join(EVIDENCE_ROOT, scenario);
	mkdirSync(dir, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	try {
		if (session) {
			let frame = "";
			try {
				frame = session.capture();
			} catch {
				frame = "<pane dead>";
			}
			writeFileSync(join(dir, `pane-${stamp}.txt`), frame);
		}
		writeFileSync(join(dir, `detail-${stamp}.txt`), detail);
	} catch {
		// evidence best-effort; never mask the real failure
	}
}

/**
 * Bounded poll for a predicate over the captured pane. No fixed sleeps.
 * On timeout: evidence saved, assertion error thrown.
 */
export async function waitForPane(
	scenario: string,
	session: TuiSession,
	predicate: (frame: string) => boolean,
	description: string,
	timeoutMs = 15_000,
): Promise<string> {
	const started = Date.now();
	let last = "";
	while (Date.now() - started < timeoutMs) {
		try {
			last = session.capture();
			if (predicate(last)) return last;
		} catch (err) {
			last = `capture failed: ${String(err)}`;
		}
		await new Promise((r) => setTimeout(r, 120));
	}
	saveEvidence(
		scenario,
		session,
		`waitForPane timeout: ${description}\n\nlast frame:\n${last}`,
	);
	throw new Error(
		`timed out after ${timeoutMs}ms waiting for ${description} (evidence in ${join(EVIDENCE_ROOT, scenario)})`,
	);
}

/**
 * Quit cleanly via the app's own key, fall back to SIGHUP via kill-session,
 * then assert the app process is gone and no llama-server orphan survived.
 */
export async function shutdownAndCheckOrphans(
	scenario: string,
	session: TuiSession,
): Promise<void> {
	// Best effort: if the pane already died (crash), skip the quit keys.
	if (!session.paneDead()) {
		try {
			session.key("q");
		} catch {
			// pane may already be dead
		}
	}
	const started = Date.now();
	while (Date.now() - started < 8000) {
		if (session.paneDead()) break;
		// A modal or text field may swallow the first q (real key delivery
		// races): re-send Escape + q at a measured pace.
		if (Math.floor((Date.now() - started) / 2500) === 1) {
			try {
				session.key("Escape");
				session.key("q");
			} catch {
				// pane died between checks
			}
		}
		await new Promise((r) => setTimeout(r, 100));
	}
	session.dispose();

	if (session.appPid !== null) {
		const alive = spawnSync("ps", ["-p", String(session.appPid)]);
		if ((alive.stdout.toString() as string).includes(String(session.appPid))) {
			saveEvidence(
				scenario,
				session,
				`orphaned app pid=${session.appPid} survived teardown`,
			);
			throw new Error(`orphaned app process ${session.appPid} survived quit`);
		}
	}
	const serverOrphans = spawnSync("pgrep", ["-x", "llama-server"]);
	if (
		serverOrphans.status === 0 &&
		(serverOrphans.stdout.toString() as string).trim().length > 0
	) {
		saveEvidence(scenario, session, "llama-server orphan detected");
		throw new Error("llama-server orphan survived teardown");
	}
}
