const HANDLED_EVENTS = [
	"SIGINT",
	"SIGTERM",
	"SIGHUP",
	"uncaughtException",
	"unhandledRejection",
	"beforeExit",
] as const;

export type ExitHookEvent = (typeof HANDLED_EVENTS)[number];
export type RegisterFn = (
	event: ExitHookEvent,
	handler: (arg?: unknown) => void,
) => unknown;
export type UnregisterFn = (
	event: ExitHookEvent,
	handler: (arg?: unknown) => void,
) => void;

export interface ExitHooksHandle {
	unregister(): void;
	runOnce(): Promise<void>;
}

const SIGNAL_EXIT_CODES: Partial<Record<ExitHookEvent, number>> = {
	SIGINT: 130,
	SIGTERM: 143,
	SIGHUP: 129,
};

export function registerExitHooks(
	teardown: () => Promise<void>,
	register: RegisterFn = (ev, fn) =>
		process.on(ev as NodeJS.Signals, fn as NodeJS.SignalsListener),
	unregister: UnregisterFn = (ev, fn) =>
		process.off(ev as NodeJS.Signals, fn as NodeJS.SignalsListener),
	exitFn: (code: number) => void = (code) => process.exit(code),
): ExitHooksHandle {
	let ran = false;
	let running: Promise<void> | null = null;
	const runOnce = async (): Promise<void> => {
		if (ran) return running ?? Promise.resolve();
		ran = true;
		running = teardown().finally(() => {
			running = null;
		});
		return running;
	};
	const handlers = new Map<ExitHookEvent, (arg?: unknown) => void>();
	for (const event of HANDLED_EVENTS) {
		const handler = (_arg?: unknown) => {
			void runOnce().then(() => {
				if (event === "beforeExit") return;
				const code = SIGNAL_EXIT_CODES[event] ?? 1;
				exitFn(code);
			});
		};
		handlers.set(event, handler);
		register(event, handler);
	}
	return {
		runOnce,
		unregister() {
			for (const [event, handler] of handlers) unregister(event, handler);
			handlers.clear();
		},
	};
}
