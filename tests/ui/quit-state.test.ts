import { describe, expect, it } from "bun:test";
import {
	type ConfirmKind,
	createQuitState,
	handleHostKey,
	handleKillKey,
	handleQuitKey,
	type QuitState,
} from "../../src/ui/logic/quit-state";

const NOW = 10_000;
const WINDOW = 2000;

function armed(kind: ConfirmKind): QuitState {
	return { pending: kind, armedAt: NOW };
}

describe("Ctrl+C semantics (§4, P5-FR-11)", () => {
	it("no server running -> immediate quit, no confirmation", () => {
		const r = handleQuitKey(createQuitState(), NOW, false);
		expect(r.action).toBe("quit");
	});

	it("server running -> first press asks for confirmation", () => {
		const r = handleQuitKey(createQuitState(), NOW, true);
		expect(r.action).toBe("confirm");
		expect(r.state.pending).toBe("quit");
	});

	it("second press within 2 s force-quits", () => {
		const r = handleQuitKey(armed("quit"), NOW + 1500, true);
		expect(r.action).toBe("quit");
	});

	it("second press after 2 s re-arms (asks again)", () => {
		const r = handleQuitKey(armed("quit"), NOW + WINDOW + 1, true);
		expect(r.action).toBe("confirm");
		expect(r.state.armedAt).toBe(NOW + WINDOW + 1);
	});
});

describe("x kill semantics (P5-FR-11)", () => {
	it("first x with server running -> confirm kill", () => {
		const r = handleKillKey(createQuitState(), NOW, true);
		expect(r.action).toBe("confirm");
		expect(r.state.pending).toBe("kill");
	});

	it("second x within window kills", () => {
		const r = handleKillKey(armed("kill"), NOW + 1000, true);
		expect(r.action).toBe("execute");
		expect(r.state.pending).toBeNull();
	});

	it("x with no server is a no-op", () => {
		const r = handleKillKey(createQuitState(), NOW, false);
		expect(r.action).toBe("none");
	});

	it("other confirm kind resets the arm", () => {
		const r = handleKillKey(armed("quit"), NOW + 500, true);
		expect(r.action).toBe("confirm");
		expect(r.state.pending).toBe("kill");
	});
});

describe("Ctrl+Y host-exposure confirmation (Phase 13, P5-FR-11)", () => {
	it("first Ctrl+Y arms and asks to confirm", () => {
		const r = handleHostKey(createQuitState(), NOW);
		expect(r.action).toBe("confirm");
		expect(r.state.pending).toBe("host");
		if (r.action === "confirm") expect(r.message).toContain("ALL interfaces");
	});

	it("second Ctrl+Y within the window executes", () => {
		const r = handleHostKey(armed("host"), NOW + 1000);
		expect(r.action).toBe("execute");
		expect(r.state.pending).toBeNull();
	});

	it("second Ctrl+Y after the window re-arms", () => {
		const r = handleHostKey(armed("host"), NOW + WINDOW + 1);
		expect(r.action).toBe("confirm");
		expect(r.state.armedAt).toBe(NOW + WINDOW + 1);
	});

	it("a pending kill does not satisfy the host arm", () => {
		const r = handleHostKey(armed("kill"), NOW + 500);
		expect(r.action).toBe("confirm");
		expect(r.state.pending).toBe("host");
	});
});
