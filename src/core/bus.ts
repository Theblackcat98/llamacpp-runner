type Handler<P> = (payload: P) => void;

export class Bus<Intents extends object, States extends object> {
	private intentHandlers = new Map<keyof Intents, Set<Handler<never>>>();
	private stateHandlers = new Map<keyof States, Set<Handler<never>>>();

	onIntent<K extends keyof Intents>(
		key: K,
		handler: Handler<Intents[K]>,
	): () => void {
		return this.subscribe(this.intentHandlers, key, handler as Handler<never>);
	}

	onState<K extends keyof States>(
		key: K,
		handler: Handler<States[K]>,
	): () => void {
		return this.subscribe(this.stateHandlers, key, handler as Handler<never>);
	}

	emitIntent<K extends keyof Intents>(key: K, payload: Intents[K]): void {
		this.publish(this.intentHandlers, key, payload);
	}

	emitState<K extends keyof States>(key: K, payload: States[K]): void {
		this.publish(this.stateHandlers, key, payload);
	}

	clear(): void {
		this.intentHandlers.clear();
		this.stateHandlers.clear();
	}

	private subscribe<M extends object>(
		handlers: Map<keyof M, Set<Handler<never>>>,
		key: keyof M,
		handler: Handler<never>,
	): () => void {
		let set = handlers.get(key);
		if (!set) {
			set = new Set();
			handlers.set(key, set);
		}
		set.add(handler);
		return () => {
			set?.delete(handler);
			if (set && set.size === 0) handlers.delete(key);
		};
	}

	private publish<M extends object>(
		handlers: Map<keyof M, Set<Handler<never>>>,
		key: keyof M,
		payload: unknown,
	): void {
		const set = handlers.get(key);
		if (!set) return;
		for (const handler of [...set]) {
			(handler as Handler<typeof payload>)(payload);
		}
	}
}

export function createBus<Intents extends object, States extends object>() {
	return new Bus<Intents, States>();
}
