# Issue #42 — Shell key routing hardening: remaining work

Branch: `issue/42-shell-key-routing` (pushed). Issue: #42 (label `in-progress`).
Plan of record for finishing the keyboard-routing hardening started in
response to the user-reported alias-digits bug class (#26, #37, #41, #42).

## Status — done on the branch

- `3a80489` — `tests/ui/keyboard-routing.test.tsx`: text-field × shortcut
  interference matrix (host, port, alias, chat-template, explorer dir editor
  × all global printables, asserted in both directions), same-tick burst
  delivery, inverse global-shortcut checks. Found 4 real bugs.
- `f6e88a1` — the fix, full suite green (612 pass / 0 fail, goldens unchanged):
  - Configurator mirrors `field` in a ref at event time (`fieldRef`), notifies
    the shell synchronously on moves, and forwards printables through state
    while the move is uncommitted (`TEXT_FIELD_FLAG` map).
  - TextInput takes optional `field` + `activeFieldRef` and ignores keys the
    ref doesn't assign to it — kills stale-subscription double delivery
    between adjacent text fields.
  - Explorer notifies `onEditingChange` at event time (`setEditing`); App
    keeps `explorerEditingRef`.
  - App yields Enter to the dir editor while it is open (confirm path);
    Enter=Launch stays advertised on the Configurator.

## Remaining work item 1 — extract pure `routeShellKey` (refactor)

Behavior-identical extraction of the App key handler (`src/ui/app.tsx`,
the `useKeyboard` body) into `src/ui/logic/shell-key-routing.ts`, in the
house style of `logic/quit-state.ts` / `logic/palette-state.ts`:

- `routeShellKey(ctx: ShellKeyContext, key: KeyRef): ShellAction[]`
- `ShellKeyContext` (all inputs the handler reads today): `tab`,
  `focusPane`, `textFieldActive` (configurator text field owns printables,
  per `activeConfiguratorField.current`), `dirEditorOpen` (tab 0 +
  `explorerEditingRef.current`), `paletteOpen`, `importOpen`,
  `serverRunning`, `confirm: QuitState`, `killArmedAt`, `nowMs`, and
  presence flags (`hasExplorer`, `hasSavePreset`, `hasYank`, `hasConfirmHost`,
  `hasTelemetry`).
- `ShellAction` — discriminated union: `yieldToField`, `paletteKey`,
  `toggleHelp`, quit/kill/host results (reuse `handleQuitKey` /
  `handleKillKey` / `handleHostKey` verbatim — they already return
  `{action, state}`), `launch`, `rescan`, `savePreset`, `yank`, `openImport`,
  `enableTelemetry`, `cycleFocusPane`, `switchTab(n)`, `clearLog`,
  `toggleDrawer`, `armKillOrphan` / `executeKillOrphan`,
  `setConfirm(state, notice?)`, `drawerScroll(delta | pinTail)`.
- App's `useKeyboard` becomes: build ctx → `routeShellKey` → apply actions.
  No rendering or listener changes; `keyboard-ownership.test.tsx` listener
  counts must stay identical.

### Table-driven unit test

`tests/ui/shell-key-routing.test.ts` — exhaustive contexts × keys → expected
actions, no rendering. Include the boundaries the App-level matrix can't
cheaply enumerate: palette open × every key, import open × every key,
`focusPane === 1` × drawer keys, Ctrl+S both event forms (`{name:"s",ctrl}`
and `sequence:"\x13"` — see the comment in `app.tsx`), digits 1-4 vs 5-9,
`serverRunning` × quit/kill arm-then-execute windows (pass fixed `nowMs`).

## Remaining work item 2 — verification gates

- `bunx biome check <changed files>` (repo-wide `bun run lint` already fails
  on `main` — pre-existing debt in unrelated files + `.tmp/` scratch scanned
  by biome; out of scope for #42, worth its own issue).
- `bun run typecheck` clean.
- Full `bun test` green, zero skipped tests. Golden frames unchanged —
  any golden diff is a regression signal, NOT an `UPDATE_GOLDEN=1` candidate.

## Remaining work item 3 — merge & close (AGENTS.md loop)

1. `git checkout main && git merge --no-ff issue/42-shell-key-routing`
2. `git branch -d issue/42-shell-key-routing`
3. `gh issue close 42 --comment "Resolved on main in commit $(git rev-parse --short HEAD)"`
4. `gh issue edit 42 --remove-label "in-progress"`

## Deferred (tracked in #42 body, do not fold into this branch)

- Composition-root E2E flows → issue #31.
- tmux-level digit check in `tests/automated-manual/` (real-terminal key
  reporting differs from mockInput; Ctrl+S precedent in `app.tsx`).
- Seeded fuzz/property layer with invariant checking.
- Adopt-or-delete `src/ui/focus/*` (FocusProvider / `routeKey` are dead code;
  the pure-router extraction above supersedes the adoption path).
- Known limitation, documented in the matrix test: burst keys delivered in
  the same tick a text field is *entered* are forwarded at buffer-end
  (cursor position not honored); the Explorer dir editor swallows (not
  forwards) same-tick burst chars between "m" and commit — guard invariants
  hold either way.
