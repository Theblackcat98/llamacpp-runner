import type { Bus } from "./bus";
import type { IntentMap, StateMap } from "./bus-contract";
import { registerExitHooks } from "./process/cleanup";
import { inspectOrphan, killOrphan } from "./process/orphan";
import { Supervisor } from "./process/supervisor";
import { clearPidFile, ensureDir, writePidFile } from "./store/pidfile";
import type { AppPaths } from "./store/state-paths";

export interface SessionOptions {
	command: string;
	args: string[];
	port: number;
	presetId: string;
	paths: AppPaths;
	bus: Bus<IntentMap, StateMap>;
	supervisor?: Supervisor;
}

export interface Session {
	bus: Bus<IntentMap, StateMap>;
	supervisor: Supervisor;
	foundOrphanPid?: number;
	boot(): Promise<void>;
	shutdown(): Promise<void>;
	killFoundOrphan(): Promise<boolean>;
}

export function createSession(opts: SessionOptions): Session {
	const { bus, paths } = opts;
	const supervisor =
		opts.supervisor ??
		new Supervisor({
			command: opts.command,
			args: opts.args,
			port: opts.port,
			host: "127.0.0.1",
			readyPattern: /listening on|server is listening/i,
		});

	let foundOrphanPid: number | undefined;

	const sysLog = (text: string) =>
		bus.emitState("LOG_LINE", { stream: "out", text: `[SYS] ${text}` });

	supervisor.onLog((line) =>
		bus.emitState("LOG_LINE", { stream: "out", text: line }),
	);
	supervisor.onState((event) => {
		if (event.state === "LOADING" && supervisor.pid !== undefined) {
			writePidFile(paths.pidFile, {
				pid: supervisor.pid,
				port: opts.port,
				presetId: opts.presetId,
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
		});
	});

	const hooks = registerExitHooks(async () => {
		await supervisor.kill();
	});

	bus.onIntent("LAUNCH", () => {
		void supervisor.start();
	});
	bus.onIntent("KILL", () => {
		clearPidFile(paths.pidFile);
		void supervisor.kill();
	});
	bus.onIntent("QUIT", () => {
		void shutdown();
	});

	async function boot(): Promise<void> {
		ensureDir(paths.stateDir);
		ensureDir(paths.configDir);
		if (opts.command.includes("/") || Bun.which(opts.command)) {
			sysLog(`binary ok: ${opts.command}`);
		} else {
			sysLog(`warning: ${opts.command} not found on PATH`);
		}
		const inspection = await inspectOrphan(paths.pidFile);
		if (inspection.status === "stale") {
			sysLog("stale pidfile cleaned");
		}
		if (inspection.status === "alive" && inspection.record) {
			foundOrphanPid = inspection.record.pid;
			bus.emitState("ORPHAN_FOUND", { ...inspection.record });
			sysLog(
				`orphaned llama-server pid=${inspection.record.pid} port=${inspection.record.port ?? "?"} — press K to kill`,
			);
		}
	}

	async function shutdown(): Promise<void> {
		await supervisor.kill();
		hooks.unregister();
	}

	return {
		bus,
		supervisor,
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
