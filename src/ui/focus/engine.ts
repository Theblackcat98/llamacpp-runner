export interface FocusEngine {
	order: string[];
	current: string;
	/** When true, printable keys are captured by the focused input widget. */
	captureMode: boolean;
	onFocusChange?: (from: string | undefined, to: string) => void;
}

export function createFocusEngine(order: string[]): FocusEngine {
	return { order, current: order[0] ?? "", captureMode: false };
}

export function cycleFocus(engine: FocusEngine, shift: boolean): FocusEngine {
	if (engine.order.length === 0) return engine;
	const i = engine.order.indexOf(engine.current);
	const next =
		i === -1
			? 0
			: (i + (shift ? -1 : 1) + engine.order.length) % engine.order.length;
	const target = engine.order[next] ?? engine.current;
	if (target === engine.current) return engine;
	engine.onFocusChange?.(engine.current, target);
	return { ...engine, current: target };
}

export function setInputCapture(
	engine: FocusEngine,
	capture: boolean,
): FocusEngine {
	return { ...engine, captureMode: capture };
}

export interface RoutedKey {
	name?: string;
	ctrl?: boolean;
	meta?: boolean;
}

export interface RouteResult {
	captured: boolean;
	global: boolean;
}

export interface RouteSinks {
	onCapture?: (key: RoutedKey) => void;
	onGlobal?: (key: RoutedKey) => void;
}

/**
 * Normal mode — every key is offered to the global sink.
 * Input capture mode (P2-FR-13) — printable keys go to the focused input
 * only; control keys still reach the global sink.
 */
export function routeKey(
	engine: FocusEngine,
	key: RoutedKey,
	sinks: RouteSinks = {},
): RouteResult {
	const printable = (key.name?.length ?? 0) <= 1 && !key.ctrl && !key.meta;
	if (engine.captureMode && printable) {
		sinks.onCapture?.(key);
		return { captured: true, global: false };
	}
	sinks.onGlobal?.(key);
	return { captured: false, global: true };
}
