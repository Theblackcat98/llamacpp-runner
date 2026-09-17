/**
 * Pure shell key router (#42): the App `useKeyboard` body extracted so the
 * contexts × keys matrix is unit-testable without rendering. The App builds
 * the context snapshot, routes, then applies the returned actions — behavior
 * frozen from the pre-extraction handler (golden frames unchanged).
 */
import { CONFIGURATOR_TAB, PRESETS_TAB } from "../constants";
import {
	type ConfirmAction,
	handleHostKey,
	handleKillKey,
	handleQuitKey,
	type QuitState,
} from "./quit-state";
import { isQuitKey, type KeyRef, TAB_COUNT } from "./shell-state";

/** Everything the shell key handler reads, snapshotted for one key event. */
export interface ShellKeyContext {
	tab: number;
	focusPane: number;
	/** A Configurator text field or the Explorer dir editor owns printables. */
	textFieldActive: boolean;
	/** The Explorer dir editor is open on tab 0 and owns Enter. */
	dirEditorOpen: boolean;
	paletteOpen: boolean;
	importOpen: boolean;
	serverRunning: boolean;
	confirm: QuitState;
	killArmedAt: number | null;
	nowMs: number;
	hasLaunch: boolean;
	hasExplorer: boolean;
	hasSavePreset: boolean;
	hasYank: boolean;
	hasConfirmHost: boolean;
	/** #55: pid of the discovered orphaned server, null when none exists. */
	foundOrphanPid: number | null;
	/** #55: a focused list table claims k for row navigation. */
	tableFocused: boolean;
}

export type ShellAction =
	| { type: "yieldToField" }
	| { type: "paletteKey"; key: KeyRef }
	| { type: "toggleHelp" }
	| { type: "setConfirm"; state: QuitState }
	| { type: "setNotice"; notice: string | null }
	| { type: "quit" }
	| { type: "launch" }
	| { type: "kill" }
	| { type: "armKillOrphan"; nowMs: number }
	| { type: "executeKillOrphan" }
	| { type: "clearLog" }
	| { type: "toggleDrawer" }
	| { type: "rescan" }
	| { type: "savePreset" }
	| { type: "yank" }
	| { type: "openImport" }
	| { type: "confirmHost" }
	| { type: "enableTelemetry" }
	| { type: "cycleFocusPane"; forward: boolean }
	| { type: "switchTab"; tab: number }
	| { type: "drawerScroll"; by: number }
	| { type: "drawerPinTail" };

function confirmActions(
	result: ConfirmAction,
	executeType: "kill" | "confirmHost",
): ShellAction[] {
	const actions: ShellAction[] = [{ type: "setConfirm", state: result.state }];
	if (result.action === "execute") {
		actions.push({ type: "setNotice", notice: null }, { type: executeType });
	} else if (result.action === "confirm") {
		actions.push({ type: "setNotice", notice: result.message ?? null });
	}
	return actions;
}

export function routeShellKey(
	ctx: ShellKeyContext,
	key: KeyRef,
): ShellAction[] {
	if (ctx.importOpen) {
		return [];
	}
	if ((key.ctrl && key.name === "p") || ctx.paletteOpen) {
		return [{ type: "paletteKey", key }];
	}
	// While a Configurator text field is focused, plain printable keys go
	// to the input alone — digits must not switch tabs, o/x/k/q must not
	// trigger shell actions (Phase 13 one-owner rule). Ctrl combos still
	// pass: Ctrl+C/P/S/Y/L are non-printable shell bindings.
	if (ctx.textFieldActive && key.name && key.name.length === 1 && !key.ctrl) {
		return [{ type: "yieldToField" }];
	}
	if (key.name === "?" && !key.ctrl) {
		return [{ type: "toggleHelp" }];
	}
	if (isQuitKey(key)) {
		const result = handleQuitKey(ctx.confirm, ctx.nowMs, ctx.serverRunning);
		if (result.action === "quit") {
			return [
				{ type: "setConfirm", state: result.state },
				{ type: "setNotice", notice: null },
				{ type: "quit" },
			];
		}
		if (result.action === "confirm") {
			return [
				{ type: "setConfirm", state: result.state },
				{ type: "setNotice", notice: result.message ?? null },
			];
		}
		return [{ type: "setConfirm", state: result.state }];
	}
	// The Explorer's dir editor owns Enter while open (confirm path);
	// on the Configurator, Enter=Launch is the advertised binding (#42).
	if (
		key.name === "return" &&
		ctx.hasLaunch &&
		ctx.tab !== PRESETS_TAB &&
		!ctx.dirEditorOpen
	) {
		return [{ type: "launch" }];
	}
	if (key.name === "x" && !key.ctrl) {
		return confirmActions(
			handleKillKey(ctx.confirm, ctx.nowMs, ctx.serverRunning),
			"kill",
		);
	}
	if (key.name === "k" && !key.ctrl) {
		// #55 one-owner rule: a focused list table owns k for row
		// navigation, and with no orphan discovered there is nothing to
		// arm — the notice must never fire from plain table scrolling.
		if (ctx.tableFocused || ctx.foundOrphanPid === null) {
			return [];
		}
		if (ctx.killArmedAt !== null && ctx.nowMs - ctx.killArmedAt <= 2000) {
			return [
				{ type: "setNotice", notice: null },
				{ type: "executeKillOrphan" },
			];
		}
		return [
			{ type: "armKillOrphan", nowMs: ctx.nowMs },
			{
				type: "setNotice",
				notice: "press k again within 2s to kill the orphaned server",
			},
		];
	}
	if (key.ctrl && key.name === "l") {
		return [{ type: "clearLog" }];
	}
	if (key.name === "o") {
		return [{ type: "toggleDrawer" }];
	}
	if (key.name === "r" && ctx.hasExplorer && ctx.tab === 0) {
		return [{ type: "rescan" }];
	}
	// OpenTUI normally reports Ctrl+S as { name: "s", ctrl: true }, but
	// terminals using a raw control sequence can omit `name`. Accept both
	// forms so saving does not depend on the terminal/parser combination.
	const isCtrlS =
		key.ctrl && (key.name?.toLowerCase() === "s" || key.sequence === "\x13");
	if (isCtrlS && ctx.tab === CONFIGURATOR_TAB && ctx.hasSavePreset) {
		return [{ type: "savePreset" }];
	}
	if (
		key.name === "y" &&
		!key.ctrl &&
		ctx.tab === CONFIGURATOR_TAB &&
		ctx.hasYank
	) {
		return [{ type: "yank" }];
	}
	if (
		key.name === "i" &&
		!key.ctrl &&
		(ctx.tab === CONFIGURATOR_TAB || ctx.tab === PRESETS_TAB)
	) {
		return [{ type: "openImport" }];
	}
	if (key.ctrl && key.name === "y" && ctx.hasConfirmHost) {
		// Phase 13: host exposure needs an explicit second confirmation.
		return confirmActions(handleHostKey(ctx.confirm, ctx.nowMs), "confirmHost");
	}
	if (key.name === "t" && !key.ctrl && ctx.tab === 2) {
		return [{ type: "enableTelemetry" }];
	}
	if (key.name === "tab") {
		return [{ type: "cycleFocusPane", forward: !key.shift }];
	}
	const digit = Number.parseInt(key.name ?? "", 10);
	if (digit >= 1 && digit <= TAB_COUNT) {
		// Switching screens always returns focus to the visible content pane.
		return [{ type: "switchTab", tab: digit - 1 }];
	}
	if (ctx.focusPane === 1) {
		if (key.name === "up") return [{ type: "drawerScroll", by: -1 }];
		if (key.name === "down") return [{ type: "drawerScroll", by: 1 }];
		if (key.name === "g" || key.name === "end")
			return [{ type: "drawerPinTail" }];
	}
	return [];
}
