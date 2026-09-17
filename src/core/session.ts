import type { Bus } from "./bus";
import type { IntentMap, StateMap } from "./bus-contract";
import { registerExitHooks } from "./process/cleanup";
import { inspectOrphan, killOrphan } from "./process/orphan";
import {
	findNextFreePort,
	requiresHostConfirmation,
} from "./process/preflight";
import {
	type Supervisor,
	Supervisor as SupervisorClass,
	type SupervisorTimings,
} from "./process/supervisor";
import { clearPidFile, ensureDir, writePidFile } from "./store/pidfile";
import type { AppPaths } from "./store/state-paths";
import { classifyFailure } from "./telemetry/failure-classifier";

/** A fully-resolved launch: argv comes from the flag registry builder (§3.3). */
export interface LaunchPlan {
	command: string;
	args: string[];
	port: number;
	presetId: string;
	host?: string;
	env?: Record<string, string>;
	timings?: Partial<SupervisorTimings>;
	onSpawn?: (port: number) => void;
}

export type LaunchResolver = () => LaunchPlan | null;

export interface SessionOptions {
	command?: string;
	args?: string[];
	port?: number;
	presetId?: string;
	paths: AppPaths;
	bus: Bus<IntentMap, StateMap>;
	supervisor?: Supervisor;
	/**
	 * Dynamic launch pipeline (P4-FR-03): when set, each LAUNCH resolves a
	 * fresh plan (configurator/preset values) instead of the static args.
	 */
	resolveLaunch?: LaunchResolver;
}

export interface Session {
	bus: Bus<IntentMap, StateMap>;
	/**
	 * Null until the first launch resolves a plan. Sessions booted with
	 * only `resolveLaunch` (the TUI boot path) have no supervisor yet —
	 * callers must handle the pre-launch state instead of expecting a throw.
	 */
	supervisor: Supervisor | null;
	foundOrphanPid?: number;
	boot(): Promise<void>;
	shutdown(): Promise<void>;
	killFoundOrphan(): Promise<boolean>;
}

function newSupervisor(plan: LaunchPlan): Supervisor {
	return new SupervisorClass({
		command: plan.command,
		args: plan.args,
		port: plan.port,
		host: plan.host ?? "127.0.0.1",
		readyPattern: /listening on|server is listening/i,
		timings: plan.timings,
		env: plan.env,
	});
}

export function createSession(opts: SessionOptions): Session {
	const { bus, paths } = opts;

	const sysLog = (text: string) =>
		bus.emitState("LOG_LINE", { stream: "out", text: `[SYS] ${text}` });

	function wireSupervisor(
		plan: LaunchPlan,
		supervisor: Supervisor,
	): Supervisor {
		supervisor.onLog((line) =>
			bus.emitState("LOG_LINE", { stream: "out", text: line }),
		);
		supervisor.onState((event) => {
			if (event.state === "LOADING" && supervisor.pid !== undefined) {
				writePidFile(paths.pidFile, {
					pid: supervisor.pid,
					port: plan.port,
					presetId: plan.presetId,
					startedAt: new Date().toISOString(),
				});
			}
			if (event.state === "IDLE" || event.state === "FAILED") {
				clearPidFile(paths.pidFile);
			}
			bus.emitState("PROC_STATE", {
				state: event.state,
				detail: event.detail,
				exitCode: event.exitCode,
				tail: event.tail,
				startedAtMs: event.startedAtMs ?? supervisor.startedAtMs,
			});
			if (event.state === "FAILED") {
				const classified = classifyFailure(
					event.exitCode ?? null,
					null,
					event.tail ?? supervisor.snapshotTail(50),
					event.detail,
				);
				if (classified) {
					bus.emitState("FAILURE_CLASSIFIED", classified);
					sysLog(
						`FAILED: ${classified.summary} — fix: ${classified.suggestion}`,
					);
				}
			}
		});
		return supervisor;
	}

	let active: Supervisor | null = null;

	if (opts.supervisor) {
		active = wireSupervisor(
			{
				command: opts.command ?? "",
				args: opts.args ?? [],
				port: opts.port ?? 8080,
				presetId: opts.presetId ?? "unknown",
			},
			opts.supervisor,
		);
	} else if (opts.command) {
		const plan: LaunchPlan = {
			command: opts.command,
			args: opts.args ?? [],
			port: opts.port ?? 8080,
			presetId: opts.presetId ?? "unknown",
		};
		active = wireSupervisor(plan, newSupervisor(plan));
	}

	async function handleLaunch(intent: {
		confirmedHost?: boolean;
	}): Promise<void> {
		if (active?.isRunning) {
			// Exactly one managed instance (P4-FR-20, D4): UI prompts stop/cancel.
			bus.emitState("LAUNCH_BLOCKED", { reason: "instance_running" });
			return;
		}
		const plan: LaunchPlan | null =
			opts.resolveLaunch?.() ??
			(opts.command
				? {
						command: opts.command,
						args: opts.args ?? [],
						port: opts.port ?? 8080,
						presetId: opts.presetId ?? "unknown",
					}
				: null);
		if (!plan) {
			sysLog("no launch configuration: select a model first");
			return;
		}
		// 0.0.0.0 exposes every interface — require explicit confirmation (P4-FR-09).
		if (requiresHostConfirmation(plan.host) && !intent.confirmedHost) {
			bus.emitState("CONFIRM_REQUIRED", { host: plan.host ?? "" });
			return;
		}
		// Pre-flight bind check + next-free-port suggestion (P4-FR-10).
		const preflight = await findNextFreePort(
			plan.port,
			plan.host ?? "127.0.0.1",
		);
		if (!preflight.free) {
			bus.emitState("PORT_CONFLICT", {
				requested: plan.port,
				suggested: preflight.suggested,
			});
			return;
		}

		active = wireSupervisor(plan, newSupervisor(plan));
		void active.start();
		plan.onSpawn?.(plan.port);
	}

	let foundOrphanPid: number | undefined;

	const hooks = registerExitHooks(async () => {
		await active?.kill();
	});

	bus.onIntent("LAUNCH", (intent) => {
		void handleLaunch(intent);
	});
	bus.onIntent("KILL", () => {
		clearPidFile(paths.pidFile);
		void active?.kill();
	});
	bus.onIntent("QUIT", () => {
		void shutdown();
	});

	async function boot(): Promise<void> {
		ensureDir(paths.stateDir);
		ensureDir(paths.configDir);
		// #57: only judge a binary boot can actually see. The TUI wires
		// resolveLaunch after mount, so at boot time no command exists —
		// warning then trains users to ignore SYS warnings. The SessionApp
		// probeBinaryAvailability effect is the single source of truth.
		const bin = opts.resolveLaunch?.()?.command ?? opts.command;
		if (bin) {
			if (bin.includes("/") || Bun.which(bin)) {
				sysLog(`binary ok: ${bin}`);
			} else {
				sysLog(`warning: ${bin} not found on PATH`);
			}
		}
		const inspection = await inspectOrphan(paths.pidFile);
		if (inspection.status === "stale") {
			sysLog("stale pidfile cleaned");
		}
		if (inspection.status === "alive" && inspection.record) {
			foundOrphanPid = inspection.record.pid;
			bus.emitState("ORPHAN_FOUND", { ...inspection.record });
			sysLog(
				`orphaned llama-server pid=${inspection.record.pid} port=${inspection.record.port ?? "?"} — press k to kill`,
			);
		}
	}

	async function shutdown(): Promise<void> {
		await active?.kill();
		// Issue #16: no misleading active reference after shutdown — consumers
		// keying off `supervisor` must see pre-launch null, not a dead object.
		active = null;
		hooks.unregister();
	}

	return {
		bus,
		get supervisor(): Supervisor | null {
			return active;
		},
		get foundOrphanPid() {
			return foundOrphanPid;
		},
		boot,
		shutdown,
		async killFoundOrphan(): Promise<boolean> {
			if (foundOrphanPid === undefined) return false;
			const ok = await killOrphan(foundOrphanPid);
			if (ok) {
				clearPidFile(paths.pidFile);
				sysLog(`orphan pid=${foundOrphanPid} killed`);
				foundOrphanPid = undefined;
			}
			return ok;
		},
	};
}
