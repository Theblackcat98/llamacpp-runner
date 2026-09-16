# UI shell key-routing hardening: pure router + interference matrix

## Context

The keyboard-routing bug class (digits/global shortcuts firing while a text field has focus) has bitten repeatedly: #26 (capitals untypeable), #37 (alias input swallowed), #41 (keyboard ownership), and the user-reported alias-digits bug — now fixed at HEAD by the Phase 13 guard (`src/ui/app.tsx:234-241`). The residual risk is structural: OpenTUI broadcasts every keypress to all listeners (no consumption), and the guard depends on `activeConfiguratorField`, a ref updated **post-commit via useEffect** (`src/ui/screens/configurator.tsx:61-63`) — inherently skew-prone. The whole App key handler (`app.tsx:222-353`) is a 130-line untestable closure.

Goal (user-selected scope): extract the handler into a pure, exhaustively-tested router in the house style of `src/ui/logic/quit-state.ts` / `palette-state.ts`, and add an App-level interference matrix (every text field × every global shortcut) as the permanent regression net. UI layer only.

## Work items

### 1. Issue + branch setup
- File GitHub issue: "ui: shell key routing hardening — pure router + text-field × shortcut interference matrix" (layer:ui; reference #26/#37/#41 and the alias-digits report; note `src/ui/focus/*` is dead code to adopt-or-delete later).
- Add `in-progress` label; cut `issue/<id>-shell-key-routing` from latest `main`.

### 2. Interference matrix tests (`tests/ui/keyboard-routing.test.tsx`, new)
Drive the real `<App>` via `testRender` + `mockInput` (patterns from `tests/ui/keyboard-ownership.test.tsx`), with spy props (`onLaunch`, `onKill`, `onSavePreset`, `onYankCommand`, `explorerControl.onRescan`, `telemetryControl.onEnableTelemetry`):
- **Field × shortcut**: for each text field (host, port, alias, chat-template, explorer models-dir), focus it, then for each of `1 2 3 4 o x k q r i y t a ? Tab Esc` assert BOTH directions: printable reaches the field buffer, and no tab switch / drawer toggle / modal open / spy call / confirm notice.
- **Burst/same-tick cases** (the gap in the current suite): `pressKeys(["\x1b[B", "1"])` and `pressKeys(["1","2","3","4"])` inside one `act` with no intermediate flush — this is where the async-ref skew would still live.
- **Inverse**: with no field focused, every global shortcut DOES fire (guard doesn't over-block).
- Any failure = the red test for step 3; if all green, the suite lands as the regression net.

### 3. Fix whatever the matrix finds (only if red)
Likely candidate: make field-focus notification synchronous — call `onActiveFieldChange` in the Configurator key handler at `setField` time (`configurator.tsx:91-110`) rather than relying solely on the effect; same treatment for Explorer's `onEditingChange` if it shares the shape.

### 4. Extract pure router (refactor, behavior-identical)
- New `src/ui/logic/shell-key-routing.ts`: `routeShellKey(ctx: ShellKeyContext, key: KeyRef): ShellAction[]` — ctx = {tab, focusPane, textFieldActive, paletteOpen, importOpen, serverRunning, armed-state, now}; ShellAction = discriminated union (setTab, cycleFocus, toggleHelp, quit/kill/host flows reusing `handleQuitKey`/`handleKillKey`/`handleHostKey` as-is, launch, rescan, savePreset, yank, import, enableTelemetry, drawerScroll, yieldToField). Move the `app.tsx:222-353` body in; App's `useKeyboard` becomes build-ctx → route → apply.
- Table-driven unit test `tests/ui/shell-key-routing.test.ts`: exhaustive contexts × keys → expected actions (no rendering, ms-fast). This is where full combinatorial coverage lives.

### 5. Verify + merge (per AGENTS.md loop)
- Per commit: `bun run lint && bun run typecheck` + targeted `bun test tests/ui/`.
- Pre-merge: full `bun test`, zero skipped tests. Existing golden frames act as the behavior-freeze net — any golden diff is a regression, not an UPDATE_GOLDEN.
- Merge `--no-ff` into `main`, delete branch, close issue with commit hash, remove `in-progress`.

## Explicitly deferred (noted in the issue)
- Composition-root E2E flows → existing issue #31.
- tmux-level digit check in `tests/automated-manual/` (real-terminal key reporting, the layer mockInput can't prove — Ctrl+S precedent at `app.tsx:300-304`).
- Seeded fuzz/property layer with invariants; audit-report command; adopt-or-delete `src/ui/focus/*`.

## Out of scope
No `src/core` changes, no new dependencies, no golden-frame regeneration expected.