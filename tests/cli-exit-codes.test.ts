import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const TEST_DIR = resolve(".tmp/cli-exit-codes-test");
const configDir = `${TEST_DIR}/config`;
const stateDir = `${TEST_DIR}/state`;

function cli(args: string[]) {
	return Bun.spawnSync([process.execPath, "src/cli.ts", ...args], {
		env: {
			...process.env,
			XDG_CONFIG_HOME: configDir,
			XDG_STATE_HOME: stateDir,
		},
	});
}

beforeAll(() => {
	mkdirSync(`${configDir}/llama-deck`, { recursive: true });
	mkdirSync(stateDir, { recursive: true });
});

afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("CLI exit codes (#20): help vs usage vs runtime", () => {
	it("--help and help exit 0", () => {
		expect(cli(["--help"]).exitCode).toBe(0);
		expect(cli(["help"]).exitCode).toBe(0);
	});

	it("bare invocation exits 0 with help", () => {
		expect(cli([]).exitCode).toBe(0);
	});

	it("unknown commands exit 2", () => {
		const proc = cli(["frobnicate"]);
		expect(proc.exitCode).toBe(2);
		expect(proc.stderr.toString()).toContain("frobnicate");
	});

	it("missing required arguments exit 2", () => {
		expect(cli(["export"]).exitCode).toBe(2);
		expect(cli(["import"]).exitCode).toBe(2);
		expect(cli(["start"]).exitCode).toBe(2);
		expect(cli(["quick"]).exitCode).toBe(2);
		expect(cli(["doctor"]).exitCode).toBe(2);
	});

	it("invalid --format values exit 2", () => {
		const proc = cli(["export", "some-preset", "--format", "yaml"]);
		expect(proc.exitCode).toBe(2);
		expect(proc.stderr.toString()).toContain("yaml");
	});

	it("runtime failures keep exit 1 (model file not found)", () => {
		const proc = cli(["quick", `${TEST_DIR}/missing.gguf`]);
		expect(proc.exitCode).toBe(1);
	});

	it("unknown presets keep exit 1 (runtime, not usage)", () => {
		expect(cli(["export", "no-such-preset"]).exitCode).toBe(1);
	});

	it("--json errors use a machine-readable shape on stderr", () => {
		const proc = cli(["quick", "--json"]);
		expect(proc.exitCode).toBe(2);
		const parsed = JSON.parse(proc.stderr.toString()) as {
			error: string;
		};
		expect(parsed.error).toContain("quick");
	});

	it("documents the exit-code contract in help output", () => {
		const out = cli(["--help"]).stdout.toString();
		expect(out).toContain("Exit codes");
	});
});
