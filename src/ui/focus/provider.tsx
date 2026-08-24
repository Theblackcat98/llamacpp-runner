import { useKeyboard } from "@opentui/react";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	createFocusEngine,
	cycleFocus,
	type FocusEngine,
	type RoutedKey,
	routeKey,
} from "./engine";

type CaptureHandler = (key: RoutedKey) => void;

interface FocusContextValue {
	current: string;
	registerCapture: (id: string, handler: CaptureHandler | null) => void;
}

const FocusContext = createContext<FocusContextValue>({
	current: "",
	registerCapture: () => {},
});

export interface FocusProviderProps {
	order: string[];
	children: ReactNode;
	onGlobalKey?: (key: RoutedKey) => void;
}

/**
 * Registry-driven focus order + traversal + input-mode capture (P2-FR-13).
 * Tab/Shift+Tab always cycle. When the focused pane has an input-capture
 * handler, printable keys go to it exclusively; otherwise keys are global.
 */
export function FocusProvider({
	order,
	children,
	onGlobalKey,
}: FocusProviderProps) {
	const [engine, setEngine] = useState<FocusEngine>(() =>
		createFocusEngine(order),
	);
	const handlers = useRef(new Map<string, CaptureHandler>());
	const engineRef = useRef(engine);
	engineRef.current = engine;
	const releasedRef = useRef(false);

	const registerCapture = (id: string, handler: CaptureHandler | null) => {
		if (handler === null) handlers.current.delete(id);
		else handlers.current.set(id, handler);
	};

	useKeyboard((key) => {
		if (key.name === "tab") {
			releasedRef.current = false;
			setEngine((e) => cycleFocus(e, key.shift === true));
			return;
		}
		const e = engineRef.current;
		const capturing = handlers.current.has(e.current) && !releasedRef.current;
		if (key.name === "escape" && capturing) {
			releasedRef.current = true;
			onGlobalKey?.(key);
			return;
		}
		routeKey({ ...e, captureMode: capturing }, key, {
			onCapture: (k) => handlers.current.get(e.current)?.(k),
			onGlobal: onGlobalKey,
		});
	});

	return (
		<FocusContext.Provider value={{ current: engine.current, registerCapture }}>
			{children}
		</FocusContext.Provider>
	);
}

export function useFocus(id: string): { focused: boolean } {
	const { current } = useContext(FocusContext);
	return { focused: current === id };
}

/**
 * Registers an input-mode capture handler for pane `id`. While this pane is
 * focused, printable keys are delivered here and do NOT reach global
 * routing (typing 'j' in an input must not move a table).
 */
export function useInputCapture(
	id: string,
	handler: (key: RoutedKey) => void,
): void {
	const { registerCapture } = useContext(FocusContext);
	const handlerRef = useRef(handler);
	handlerRef.current = handler;

	useEffect(() => {
		registerCapture(id, (key) => handlerRef.current(key));
		return () => registerCapture(id, null);
	}, [id, registerCapture]);
}
