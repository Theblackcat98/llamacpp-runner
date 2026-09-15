import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { checkPortFree } from "../src/core/process/supervisor";
import { readPidFile } from "../src/core/store/pidfile";
import {
	type Preset,
	type PresetFile,
	presetsFilePath,
	savePresets,
} from "../src/core/store/presets";

const TMP = resolve(import.meta.dir, "../.tmp/cli-start");
const CONFIG_DIR = join(TMP, "config");
const STATE_DIR = join(TMP, "state");
const PID_FILE = join(STATE_DIR, "llama-deck", "server.pid");
const FAKE_SERVER = resolve("tests/fixtures/fake-server.sh");
// Copy of fake-server.sh under a `llama-server` basename so the pidfile
// identity check (isLlamaServerCommand) recognizes the managed process —
// exactly like the real binary in production.
const FAKE_LLAMA_SERVER = join(TMP, "bin", "llama-server");
const HANG_INT_SERVER = resolve("tests/fixtures/hang-int-server.sh");
const DUMMY_HELP = resolve("tests/fixtures/help/dummy-help.sh");

function cliEnv(): Record<string, string> {
	return {
		...process.env,
		XDG_CONFIG_HOME: CONFIG_DIR,
		XDG_STATE_HOME: STATE_DIR,
	} as Record<string, string>;
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function killSilently(pid: number, signal: NodeJS.Signals = "SIGKILL"): void {
	try {
		process.kill(pid, signal);
	} catch {}
}

async function freePort(from: number): Promise<number> {
	let port = from;
	while (!(await checkPortFree(port, "127.0.0.1"))) port++;
	return port;
}

async function waitForPidFile(timeoutMs: number): Promise<{ pid: number }> {
	const start = Date.now();
	for (;;) {
		const rec = readPidFile(PID_FILE);
		if (rec) return rec;
		if (Date.now() - start > timeoutMs)
			throw new Error("timed out waiting for pidfile");
		await Bun.sleep(50);
	}
}

function writePresets(portById: Record<string, number>): void {
	const presets: Preset[] = Object.entries(portById).map(([id, port]) => {
		const binary = id === "ignore-int" ? HANG_INT_SERVER : FAKE_LLAMA_SERVER;
		return {
			id,
			name: id,
			model_path: join(TMP, "m.gguf"),
			flags: { port },
			env_vars: {},
			created_at: new Date().toISOString(),
			last_used: null,
			binary_path: binary,
		} as unknown as Preset;
	});
	const doc: PresetFile = {
		version: 2,
		// Fast --help for the availability probe (the fake server would hang it).
		binary_path: DUMMY_HELP,
		presets,
	};
	savePresets(presetsFilePath(join(CONFIG_DIR, "llama-deck")), doc);
}

function spawnStart(presetId: string) {
	return Bun.spawn([process.execPath, "src/cli.ts", "start", presetId], {
		env: cliEnv(),
		stdout: "pipe",
		stderr: "pipe",
	});
}

/** Narrow Bun's spawn-stdio union to the piped stream (tests always pipe). */
function pipeStream(stream: unknown): ReadableStream<Uint8Array> {
	if (stream instanceof ReadableStream)
		return stream as ReadableStream<Uint8Array>;
	throw new Error("expected piped stdio stream");
}

async function drain(
	proc: ReturnType<typeof Bun.spawn>,
): Promise<{ out: string; err: string }> {
	// stdout may be partially consumed by waitForOutput — tolerate that.
	let out = "";
	try {
		out = await new Response(pipeStream(proc.stdout)).text();
	} catch {
		out = "";
	}
	let err = "";
	try {
		err = await new Response(pipeStream(proc.stderr)).text();
	} catch {
		err = "";
	}
	return { out, err };
}

/**
 * Wait until the CLI's stdout matches pattern (e.g. server READY line).
 * Signaling a starting server hits the §6.2 escalation path instead of a
 * clean SIGINT teardown, so tests signal only settled servers.
 */
async function waitForOutput(
	proc: ReturnType<typeof Bun.spawn>,
	pattern: RegExp,
	timeoutMs: number,
): Promise<void> {
	const reader = pipeStream(proc.stdout).getReader();
	const decoder = new TextDecoder();
	let buf = "";
	const start = Date.now();
	try {
		for (;;) {
			if (pattern.test(buf)) return;
			if (Date.now() - start > timeoutMs)
				throw new Error(`timed out waiting for ${pattern}`);
			const { done, value } = await reader.read();
			if (value) buf += decoder.decode(value, { stream: true });
			if (done) {
				buf += decoder.decode();
				if (pattern.test(buf)) return;
				throw new Error(`stream ended before ${pattern}`);
			}
		}
	} finally {
		reader.releaseLock();
	}
}

/** Kill a stray managed server recorded in the pidfile, if any. */
function killStrayServer(): void {
	const rec = readPidFile(PID_FILE);
	if (rec && isAlive(rec.pid)) killSilently(rec.pid);
}

/**
 * Issue #13: `llama-deck start` runs through the shared Supervisor lifecycle
 * (§6.2) instead of a direct Bun.spawn.
 */
describe("CLI start via Supervisor (Issue #13)", () => {
	let portA = 0;
	let portB = 0;
	let portC = 0;

	beforeAll(async () => {
		mkdirSync(join(TMP, "bin"), { recursive: true });
		copyFileSync(FAKE_SERVER, FAKE_LLAMA_SERVER);
		chmodSync(FAKE_LLAMA_SERVER, 0o755);
		portA = await freePort(18301);
		portB = await freePort(portA + 10);
		portC = await freePort(portB + 10);
		writePresets({ basic: portA, second: portB, "ignore-int": portC });
	});

	afterAll(() => {
		// Safety net: never leave a managed fake behind.
		killStrayServer();
		rmSync(TMP, { recursive: true, force: true });
	});

	it("launches through Supervisor: pidfile written, SIGINT tears down, pidfile cleaned", async () => {
		const proc = spawnStart("basic");
		const rec = await waitForPidFile(20_000);
		expect(rec.pid).toBeGreaterThan(0);
		expect(isAlive(rec.pid)).toBe(true);
		await waitForOutput(proc, /listening on/i, 20_000);

		proc.kill("SIGINT");
		const exitCode = await proc.exited;
		const { err } = await drain(proc);
		expect(err).not.toMatch(/already running/);
		expect(exitCode).toBe(0);
		expect(existsSync(PID_FILE)).toBe(false);
		await Bun.sleep(300);
		expect(isAlive(rec.pid)).toBe(false);
	}, 30_000);

	it("rejects a second start while an instance is running", async () => {
		const first = spawnStart("second");
		try {
			await waitForPidFile(20_000);
			await waitForOutput(first, /listening on/i, 20_000);
			const retry = spawnStart("second");
			// A rejected start exits promptly; a regression (second launch)
			// would hang running another server — fail fast instead.
			const winner = await Promise.race([
				retry.exited.then((code) => ({ exited: true, code }) as const),
				Bun.sleep(10_000).then(() => ({ exited: false }) as const),
			]);
			if (!winner.exited) {
				retry.kill("SIGKILL");
				await retry.exited;
				await drain(retry);
				killStrayServer();
				throw new Error(
					"second start was not rejected (launched instead of exiting 1)",
				);
			}
			const { err } = await drain(retry);
			expect(winner.code).toBe(1);
			expect(err).toMatch(/already running/);
		} finally {
			first.kill("SIGINT");
			await first.exited;
			await drain(first);
		}
		expect(existsSync(PID_FILE)).toBe(false);
	}, 30_000);

	it("escalates SIGINT -> SIGKILL when the server ignores SIGINT", async () => {
		const proc = spawnStart("ignore-int");
		const rec = await waitForPidFile(20_000);
		expect(isAlive(rec.pid)).toBe(true);
		await waitForOutput(proc, /ready/i, 20_000);
		const start = Date.now();
		proc.kill("SIGINT");
		await proc.exited;
		const elapsed = Date.now() - start;
		await drain(proc);
		// The SIGINT grace (≤5 s) is honored before SIGKILL — not instant.
		expect(elapsed).toBeGreaterThanOrEqual(4000);
		expect(existsSync(PID_FILE)).toBe(false);
		await Bun.sleep(300);
		expect(isAlive(rec.pid)).toBe(false);
	}, 30_000);
});
