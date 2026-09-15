import * as net from "node:net";
import { LineAssembler } from "./line-assembler";
import { RingBuffer } from "./ring-buffer";
import {
	type ExitInfo,
	PipeTransport,
	type SpawnOptions,
	type Transport,
} from "./transport";

export type SupervisorFailure =
	| "binary_not_found"
	| "port_in_use"
	| "spawn_error";

export interface SupervisorTimings {
	sigintGraceMs: number;
	sigkillGraceMs: number;
}

export const DEFAULT_TIMINGS: SupervisorTimings = {
	sigintGraceMs: 5000,
	sigkillGraceMs: 2000,
};

export interface SupervisorOptions extends SpawnOptions {
	port?: number;
	host?: string;
	readyPattern?: RegExp;
	timings?: Partial<SupervisorTimings>;
	transportFactory?: (opts: SpawnOptions) => Transport;
	whichFn?: (command: string) => string | null;
}

type StateListener = (event: {
	state: "STARTING" | "LOADING" | "READY" | "FAILED" | "IDLE";
	detail?: SupervisorFailure | "exited_cleanly";
	exitCode?: number;
	signal?: string | null;
	tail?: string[];
	startedAtMs?: number | null;
}) => void;

const TAIL_SIZE = 50;

export class Supervisor {
	private transport: Transport | null = null;
	private startPromise: Promise<void> | null = null;
	private teardownPromise: Promise<ExitInfo | null> | null = null;
	private teardownRequested = false;
	private exited = false;
	private exitInfo: ExitInfo | null = null;
	private readonly assembler = new LineAssembler();
	private readonly lines = new RingBuffer<string>(TAIL_SIZE);
	private logListeners = new Set<(line: string) => void>();
	private stateListeners = new Set<StateListener>();
	private readonly timings: SupervisorTimings;
	private readonly transportFactory: (opts: SpawnOptions) => Transport;
	private readonly whichFn: (command: string) => string | null;
	pid: number | undefined;
	startedAtMs: number | null = null;

	get port(): number | undefined {
		return this.opts.port;
	}

	get host(): string | undefined {
		return this.opts.host;
	}

	constructor(private readonly opts: SupervisorOptions) {
		this.timings = { ...DEFAULT_TIMINGS, ...opts.timings };
		this.transportFactory =
			opts.transportFactory ?? ((o) => new PipeTransport(o));
		this.whichFn = opts.whichFn ?? ((c) => Bun.which(c));
	}

	onLog(cb: (line: string) => void): () => void {
		this.logListeners.add(cb);
		return () => this.logListeners.delete(cb);
	}

	onState(cb: StateListener): () => void {
		this.stateListeners.add(cb);
		return () => this.stateListeners.delete(cb);
	}

	get isRunning(): boolean {
		return this.transport !== null && !this.exited;
	}

	snapshotTail(n: number = TAIL_SIZE): string[] {
		const snap = this.lines.snapshot();
		return snap.slice(Math.max(0, snap.length - n));
	}

	start(): Promise<void> {
		if (this.startPromise) return this.startPromise;
		this.teardownRequested = false;
		this.exited = false;
		this.exitInfo = null;
		this.startPromise = this.#start().finally(() => {
			this.startPromise = null;
		});
		return this.startPromise;
	}

	async kill(): Promise<ExitInfo | null> {
		this.teardownRequested = true;
		if (this.startPromise) await this.startPromise;
		return this.teardown();
	}

	async teardown(): Promise<ExitInfo | null> {
		this.teardownRequested = true;
		if (this.teardownPromise) return this.teardownPromise;
		this.teardownPromise = this.#teardown().finally(() => {
			this.teardownPromise = null;
		});
		return this.teardownPromise;
	}

	async #start(): Promise<void> {
		if (
			this.whichFn(this.opts.command) === null &&
			!this.opts.command.includes("/")
		) {
			this.emitState({ state: "FAILED", detail: "binary_not_found" });
			return;
		}
		if (this.opts.port !== undefined) {
			const free = await checkPortFree(
				this.opts.port,
				this.opts.host ?? "127.0.0.1",
			);
			if (!free) {
				this.emitState({ state: "FAILED", detail: "port_in_use" });
				return;
			}
		}
		if (this.teardownRequested) return;
		this.emitState({ state: "STARTING" });
		try {
			this.transport = this.transportFactory({
				command: this.opts.command,
				args: this.opts.args,
				cwd: this.opts.cwd,
				env: this.opts.env,
			});
		} catch (err) {
			this.emitState({ state: "FAILED", detail: "spawn_error", exitCode: -1 });
			throw err;
		}
		this.startedAtMs = Date.now();
		this.pid = this.transport.pid;
		this.transport.onData((chunk) => this.ingest(chunk));
		this.transport.onExit((info) => this.handleExit(info));
		this.emitState({ state: "LOADING" });
		if (this.teardownRequested) await this.#teardown();
	}

	async #teardown(): Promise<ExitInfo | null> {
		const t = this.transport;
		if (!t || this.exited) return this.exitInfo;
		t.kill("SIGINT");
		const graceful = await waitFor(
			() => this.exited,
			this.timings.sigintGraceMs,
		);
		if (!graceful) {
			t.kill("SIGKILL");
			await waitFor(() => this.exited, this.timings.sigkillGraceMs);
		}
		for (const line of this.assembler.flush()) this.recordLine(line);
		return this.exitInfo;
	}

	private ingest(chunk: string): void {
		for (const line of this.assembler.push(chunk)) this.recordLine(line);
	}

	private recordLine(line: string): void {
		if (this.exited) return;
		this.lines.push(line);
		for (const cb of this.logListeners) cb(line);
		const ready = this.opts.readyPattern;
		if (ready) ready.lastIndex = 0;
		if (ready?.test(line)) {
			this.emitState({ state: "READY" });
		}
	}

	private handleExit(info: ExitInfo): void {
		if (this.exited) return;
		for (const line of this.assembler.flush()) this.recordLine(line);
		this.exited = true;
		this.exitInfo = info;
		this.startedAtMs = null;
		if (info.code === 0 && info.signal === null) {
			this.emitState({ state: "IDLE", detail: "exited_cleanly", exitCode: 0 });
		} else if (info.signal !== null) {
			this.emitState({
				state: "IDLE",
				detail: undefined,
				exitCode: info.code,
				signal: info.signal,
			});
		} else {
			this.emitState({
				state: "FAILED",
				exitCode: info.code,
				tail: this.snapshotTail(TAIL_SIZE),
			});
		}
	}

	private emitState(event: Parameters<StateListener>[0]): void {
		const payload = { startedAtMs: this.startedAtMs, ...event };
		for (const cb of [...this.stateListeners]) cb(payload);
	}
}

export function checkPortFree(port: number, host: string): Promise<boolean> {
	return new Promise((resolve) => {
		const server = net.createServer();
		const done = (ok: boolean) => {
			server.removeAllListeners("error");
			resolve(ok);
		};
		server.once("listening", () => {
			server.close(() => done(true));
		});
		server.once("error", () => done(false));
		server.listen(port, host);
	});
}

function waitFor(cond: () => boolean, timeoutMs: number): Promise<boolean> {
	return new Promise((resolve) => {
		if (cond()) return resolve(true);
		const started = Date.now();
		const timer = setInterval(() => {
			if (cond()) {
				clearInterval(timer);
				resolve(true);
			} else if (Date.now() - started >= timeoutMs) {
				clearInterval(timer);
				resolve(false);
			}
		}, 10);
	});
}
