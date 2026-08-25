import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TMP = new URL("../.tmp/cli-kill/", import.meta.url).pathname;

function cli(args: string[], env?: Record<string, string>) {
	return Bun.spawnSync([process.execPath, "src/cli.ts", ...args], {
		env: {
			...process.env,
			XDG_STATE_HOME: `${TMP}state`,
			XDG_CONFIG_HOME: `${TMP}config`,
			...env,
		},
	});
}

afterAll(() => {
	rmSync(TMP, { recursive: true, force: true });
});

describe("CLI kill (P5-FR-12)", () => {
	it("no pidfile -> exit 0, reports nothing to kill", () => {
		mkdirSync(`${TMP}state/llama-deck`, { recursive: true });
		const proc = cli(["kill"]);
		expect(proc.exitCode).toBe(0);
		expect(proc.stdout.toString()).toMatch(/no server|nothing/i);
	});

	it("--json with no pidfile -> structured output", () => {
		const proc = cli(["kill", "--json"]);
		expect(proc.exitCode).toBe(0);
		const parsed = JSON.parse(proc.stdout.toString());
		expect(parsed.killed).toBe(false);
		expect(parsed.reason).toBe("no_pidfile");
	});

	it("stale pidfile is cleaned and reported", () => {
		writeFileSync(
			`${TMP}state/llama-deck/server.pid`,
			JSON.stringify({
				pid: 999_999_999,
				port: 8080,
				presetId: "t",
				startedAt: new Date().toISOString(),
			}),
		);
		const proc = cli(["kill", "--json"]);
		expect(proc.exitCode).toBe(0);
		const parsed = JSON.parse(proc.stdout.toString());
		expect(parsed.killed).toBe(false);
		expect(parsed.reason).toBe("stale");
	});

	it("live llama-server-like process is torn down via §6.2 path", async () => {
		// Double-fork: the sleeper is reparented away from this test process,
		// so it cannot linger as an un-reaped zombie mid-assertion.
		const spawner = Bun.spawnSync([
			"bash",
			"-c",
			"exec -a llama-server sleep 30 & echo $!",
		]);
		const pid = Number(spawner.stdout.toString().trim());
		expect(pid).toBeGreaterThan(0);
		await Bun.sleep(100);
		writeFileSync(
			`${TMP}state/llama-deck/server.pid`,
			JSON.stringify({
				pid,
				port: 8080,
				presetId: "t",
				startedAt: new Date().toISOString(),
			}),
		);
		const proc = cli(["kill", "--json"]);
		expect(proc.exitCode).toBe(0);
		const parsed = JSON.parse(proc.stdout.toString());
		expect(parsed.killed).toBe(true);
		expect(parsed.pid).toBe(pid);
		await Bun.sleep(200);
		expect(Bun.spawnSync(["bash", "-c", `kill -0 ${pid}`]).exitCode).not.toBe(
			0,
		);
	}, 10_000);
});

describe("CLI --json modes (P5-FR-13)", () => {
	it("scan --json emits machine-readable schema", async () => {
		const dir = join(TMP, "models");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "m.gguf"), new Uint8Array(1024)); // invalid gguf -> flagged entry, still valid JSON shape
		const proc = cli(["scan", dir, "--json"]);
		expect(proc.exitCode).toBe(0);
		const parsed = JSON.parse(proc.stdout.toString());
		expect(Array.isArray(parsed.entries)).toBe(true);
		expect(parsed.stats.filesWalked).toBeGreaterThanOrEqual(1);
	});

	it("list --json emits name array", () => {
		const dir = join(TMP, "empty");
		mkdirSync(dir, { recursive: true });
		const second = cli(["list", "--json", dir]);
		expect(second.exitCode).toBe(0);
		const parsed = JSON.parse(second.stdout.toString());
		expect(Array.isArray(parsed)).toBe(true);
	});
});
