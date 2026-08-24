import { describe, expect, it } from "bun:test";
import { createBus } from "../src/core/bus";
import type { IntentMap, StateMap } from "../src/core/bus-contract";

type TestIntents = IntentMap;
type TestStates = Pick<StateMap, "LOG_LINE" | "PROC_STATE">;

describe("event bus", () => {
	it("delivers intents to subscribers", () => {
		const bus = createBus<TestIntents, TestStates>();
		const seen: string[] = [];
		bus.onIntent("LAUNCH", (p) => seen.push(p.presetId));
		bus.emitIntent("LAUNCH", { presetId: "qwen-32b" });
		expect(seen).toEqual(["qwen-32b"]);
	});

	it("delivers state to subscribers", () => {
		const bus = createBus<TestIntents, TestStates>();
		const states: string[] = [];
		bus.onState("PROC_STATE", (p) => states.push(p.state));
		bus.emitState("PROC_STATE", { state: "STARTING" });
		bus.emitState("PROC_STATE", { state: "READY" });
		expect(states).toEqual(["STARTING", "READY"]);
	});

	it("keeps intent and state channels isolated", () => {
		const bus = createBus<TestIntents, TestStates>();
		let calls = 0;
		bus.onIntent("KILL", () => calls++);
		bus.emitState("LOG_LINE", { stream: "out", text: "hello" });
		bus.emitIntent("LAUNCH", { presetId: "x" });
		expect(calls).toBe(0);
	});

	it("stops delivery after unsubscribe", () => {
		const bus = createBus<TestIntents, TestStates>();
		let calls = 0;
		const off = bus.onIntent("KILL", () => calls++);
		bus.emitIntent("KILL", {});
		off();
		bus.emitIntent("KILL", {});
		expect(calls).toBe(1);
	});

	it("supports multiple subscribers per key", () => {
		const bus = createBus<TestIntents, TestStates>();
		const a: number[] = [];
		const b: number[] = [];
		bus.onState("PROC_STATE", (p) => a.push(p.state.length));
		bus.onState("PROC_STATE", (p) => b.push(p.state.length));
		bus.emitState("PROC_STATE", { state: "LOADING" });
		expect(a).toEqual([7]);
		expect(b).toEqual([7]);
	});

	it("does not mutate subscriber set during publish", () => {
		const bus = createBus<TestIntents, TestStates>();
		let secondCalls = 0;
		const offFirst = bus.onIntent("LAUNCH", () => {
			offFirst();
			bus.onIntent("LAUNCH", () => secondCalls++);
		});
		bus.emitIntent("LAUNCH", { presetId: "a" });
		bus.emitIntent("LAUNCH", { presetId: "b" });
		expect(secondCalls).toBe(1);
	});

	it("clear drops all handlers", () => {
		const bus = createBus<TestIntents, TestStates>();
		let calls = 0;
		bus.onIntent("QUIT", () => calls++);
		bus.clear();
		bus.emitIntent("QUIT", {});
		expect(calls).toBe(0);
	});
});
