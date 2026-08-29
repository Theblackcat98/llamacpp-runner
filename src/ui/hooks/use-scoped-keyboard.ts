import { useAppContext } from "@opentui/react";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

/**
 * Phase 13: keyboard registration that actually scopes itself.
 *
 * `useKeyboard` from @opentui/react registers a global keypress listener on
 * every mount — a screen with ten widgets (Slider, CyclingSelect, Checkbox,
 * TextInput, ...) ends up with 11 always-on listeners, tripping the
 * EventEmitter MaxListeners warning and making one keypress hit many
 * handlers. This hook only registers while `enabled` is true, so exactly one
 * focused widget listens at a time and the listener count stays flat across
 * mount/unmount cycles.
 */
export interface ScopedKey {
	name?: string;
	ctrl?: boolean;
	meta?: boolean;
	shift?: boolean;
}

function useEffectEvent<T extends (key: ScopedKey) => void>(handler: T): T {
	const ref = useRef(handler);
	useLayoutEffect(() => {
		ref.current = handler;
	});
	return useCallback((key: ScopedKey) => ref.current(key), []) as T;
}

export function useScopedKeyboard(
	enabled: boolean,
	handler: (key: ScopedKey) => void,
): void {
	const { keyHandler } = useAppContext();
	const stableHandler = useEffectEvent(handler);
	useEffect(() => {
		if (!enabled) return;
		keyHandler?.on("keypress", stableHandler);
		return () => {
			keyHandler?.off("keypress", stableHandler);
		};
	}, [keyHandler, enabled, stableHandler]);
}
