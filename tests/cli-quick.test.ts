import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { saveConfig } from "../src/core/store/config";
import { sampleLlamaQ4Km } from "./fixtures/gguf/build";

const TEST_DIR = resolve(".tmp/cli-quick-test");
const FIXTURE_FAKE_SERVER = resolve("tests/fixtures/fake-server.sh");

describe("CLI quick (§3, Issue #10)", () => {
	const modelPath = resolve(TEST_DIR, "sample.gguf");
	const configDir = `${TEST_DIR}/config`;
	const deckConfigDir = `${configDir}/llama-deck`;
	const stateDir = `${TEST_DIR}/state`;

	beforeAll(() => {
		mkdirSync(TEST_DIR, { recursive: true });
		mkdirSync(deckConfigDir, { recursive: true });
		mkdirSync(stateDir, { recursive: true });
		writeFileSync(modelPath, sampleLlamaQ4Km().buffer);
	});

	afterAll(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	it("generates resolved command containing expected argv with model-native defaults", () => {
		// Mock CPU hardware in config.json so probe doesn't find host GPU
		saveConfig(deckConfigDir, {
			theme: "tokyo-night",
			hardware: {
				kind: "cpu",
				vramBytes: null,
				totalMemBytes: 16 * 1024 * 1024 * 1024,
				source: "cpu-fallback",
			},
		});

		const proc = Bun.spawnSync(
			[process.execPath, "src/cli.ts", "quick", modelPath],
			{
				env: {
					...process.env,
					XDG_CONFIG_HOME: configDir,
					XDG_STATE_HOME: stateDir,
				},
			},
		);

		expect(proc.exitCode).toBe(0);
		const out = proc.stdout.toString();
		expect(out).toContain("-m");
		expect(out).toContain(modelPath);
		expect(out).toContain("-c 2048"); // Clamped to sample model's context_length
		expect(out).toContain("-ctk f16");
		expect(out).toContain("-ctv f16");
		expect(out).toContain("--port 8080");
		expect(out).toContain("--slots");
		expect(out).toContain("--metrics");
	});

	it("falls back to conservative defaults and reports so when hardware detection is unavailable", () => {
		// Mock CPU hardware in config.json
		saveConfig(deckConfigDir, {
			theme: "tokyo-night",
			hardware: {
				kind: "cpu",
				vramBytes: null,
				totalMemBytes: 16 * 1024 * 1024 * 1024,
				source: "cpu-fallback",
			},
		});

		const proc = Bun.spawnSync(
			[process.execPath, "src/cli.ts", "quick", modelPath],
			{
				env: {
					...process.env,
					XDG_CONFIG_HOME: configDir,
					XDG_STATE_HOME: stateDir,
				},
			},
		);

		expect(proc.exitCode).toBe(0);
		const out = proc.stdout.toString();
		expect(out).toContain("conservative defaults");
		expect(out).toContain("-ngl 0");
	});

	it("auto-fits maximum gpu layers when GPU hardware detection is available", () => {
		// Mock 24 GiB GPU hardware in config.json
		saveConfig(deckConfigDir, {
			theme: "tokyo-night",
			hardware: {
				kind: "nvidia",
				vramBytes: 24 * 1024 * 1024 * 1024,
				totalMemBytes: 64 * 1024 * 1024 * 1024,
				source: "nvidia-smi",
			},
		});

		const proc = Bun.spawnSync(
			[process.execPath, "src/cli.ts", "quick", modelPath],
			{
				env: {
					...process.env,
					XDG_CONFIG_HOME: configDir,
					XDG_STATE_HOME: stateDir,
				},
			},
		);

		expect(proc.exitCode).toBe(0);
		const out = proc.stdout.toString();
		// Sample model has 22 blocks -> block_count + 1 = 23
		expect(out).toContain("-ngl 23");
	});

	it("outputs valid JSON containing plan and estimate with --json", () => {
		const proc = Bun.spawnSync(
			[process.execPath, "src/cli.ts", "quick", modelPath, "--json"],
			{
				env: {
					...process.env,
					XDG_CONFIG_HOME: configDir,
					XDG_STATE_HOME: stateDir,
				},
			},
		);

		expect(proc.exitCode).toBe(0);
		const out = proc.stdout.toString();
		const parsed = JSON.parse(out);

		expect(parsed.plan).toBeDefined();
		expect(parsed.plan.command).toBeString();
		expect(parsed.plan.args).toBeArray();
		expect(parsed.plan.args).toContain("-m");
		expect(parsed.plan.args).toContain(modelPath);

		expect(parsed.estimate).toBeDefined();
		expect(parsed.estimate.range).toBeDefined();
		expect(parsed.estimate.range.low).toBeNumber();
		expect(parsed.estimate.range.high).toBeNumber();
		expect(parsed.estimate.range.high).toBeGreaterThan(0);
	});

	it("exits with status 1 and a clear error when model file is missing", () => {
		const missingPath = `${TEST_DIR}/nonexistent-model.gguf`;
		const proc = Bun.spawnSync(
			[process.execPath, "src/cli.ts", "quick", missingPath],
			{
				env: {
					...process.env,
					XDG_CONFIG_HOME: configDir,
					XDG_STATE_HOME: stateDir,
				},
			},
		);

		expect(proc.exitCode).toBe(1);
		const err = proc.stderr.toString();
		expect(err).toContain("Model file not found");
		expect(err).toContain(missingPath);
	});

	it("executes through supervisor with --run flag and fake-server fixture (§6.2)", async () => {
		const pidFile = `${stateDir}/llama-deck/server.pid`;
		// Ensure previous pidfile is cleaned up
		if (existsSync(pidFile)) rmSync(pidFile);

		const child = Bun.spawn(
			[
				process.execPath,
				"src/cli.ts",
				"quick",
				modelPath,
				"--run",
				"--binary",
				FIXTURE_FAKE_SERVER,
			],
			{
				env: {
					...process.env,
					XDG_CONFIG_HOME: configDir,
					XDG_STATE_HOME: stateDir,
				},
				stdout: "pipe",
				stderr: "pipe",
			},
		);

		// Wait for server to start and print output
		const reader = child.stdout.getReader();
		const decoder = new TextDecoder();
		let output = "";
		const deadline = Date.now() + 5000;

		while (Date.now() < deadline) {
			const { value, done } = await reader.read();
			if (done) break;
			output += decoder.decode(value);
			if (output.includes("listening on")) {
				break;
			}
		}

		expect(output).toContain("fake-server");
		expect(output).toContain("listening on");

		// Verify pidfile exists while running
		expect(existsSync(pidFile)).toBe(true);

		// Send SIGINT to test §6.2 graceful supervisor teardown
		child.kill("SIGINT");
		const exitCode = await child.exited;
		expect([0, 130]).toContain(exitCode);

		// Verify pidfile is cleaned up upon teardown (Windows TerminateProcess bypasses JS signal handlers)
		if (process.platform !== "win32") {
			expect(existsSync(pidFile)).toBe(false);
		} else if (existsSync(pidFile)) {
			rmSync(pidFile);
		}
	});
});
