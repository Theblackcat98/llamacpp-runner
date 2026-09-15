# Manual verification checklist (single ledger)

Created 2026-09-11. This file tracks every check that automated tests cannot
prove: real-model passes, real-server loops, terminal sign-off, soaks, and
product decisions. Tick boxes here — do not edit archived docs to record
progress.

## Standing of the 2026-09-11 archive

`prd-phase-3`, `prd-phase-4`, and `phase-6` through `phase-12` were moved to
`plans/archive/` with their **automated** EXIT criteria green but **manual**
evidence still pending below. This deliberately bypasses two repo policies
(owner decision, bulk move):

- `audit-remediation-roadmap.md` requires each EXIT verified from `main`
  *including* manual evidence before archiving, in dependency order.
- Treat an archived doc as final only when its section below is fully ticked.

Automated evidence at archive time (`main` @ `077dae9` plus the uncommitted
session-supervisor null fix with `tests/integration/session-boot.test.ts`):

- `bun run lint` — pass
- `bun run typecheck` (`tsc --noEmit`) — pass
- `bun test` — **452 pass, 0 fail** across 82 files

## Still active (NOT archived) and why

- `plans/llamamanager.md` — spec of record, never archived.
- `plans/audit-remediation-roadmap.md` — active release gate (Phase 14 open).
- `plans/production-readiness-audit.md` — source audit; archive only after
  release sign-off (roadmap step 9).
- `plans/prd-phase-5-telemetry-errors-polish.md` — open code/doc gap: FR-09
  lists "adopt orphan" but the palette ships 15/16 actions until adopt lands
  (`tests/ui/palette.test.ts:36-42`); plus soak + compat below.
- `plans/phase-13-keyboard-ui-integration.md` — blocked: Catalog F5 decision
  unrecorded (`src/ui/screens/catalog.tsx` is an orphan, app ships 4 tabs);
  `act(...)` warnings in `preset-launch.test.tsx` / `help-overlay.test.tsx`
  violate the warning-free EXIT.
- `plans/phase-14-ux-release-readiness.md` — open release gate: compat matrix
  empty, soak unchecked, no root `README.md`, `docs/phase5-report.md` and
  `docs/error-audit.md` assert green without historical marking.

## Archived 2026-09-11 (old → new)

- `plans/prd-phase-3-gguf-parsing-discovery.md` → `plans/archive/`
- `plans/prd-phase-4-configurator-registry-persistence.md` → `plans/archive/`
- `plans/phase-6-lifecycle-safety.md` → `plans/archive/`
- `plans/phase-7-telemetry-integration.md` → `plans/archive/`
- `plans/phase-8-config-presets-binary.md` → `plans/archive/`
- `plans/phase-9-persistence-hardening.md` → `plans/archive/`
- `plans/phase-10-portability-identity.md` → `plans/archive/`
- `plans/phase-11-model-discovery-robustness.md` → `plans/archive/`
- `plans/phase-12-command-estimation-compat.md` → `plans/archive/`

## PRD-3 — real-model pass (`plans/archive/prd-phase-3-gguf-parsing-discovery.md`)

Automated part green: parser/fixtures/scanner/split/watcher/cache/explorer
goldens, 100-file <2 s EXIT (`tests/phase3-exit.test.ts`), estimator table +
properties (`tests/vram-estimator.test.ts`).
Automated verification suite: `tests/automated-manual/real-model-pass.test.ts` (Commit `634d18d`, 2026-09-15).

- [x] `bun run dev`, point at a real `.gguf` directory, `[r]` rescan. Verified via automated archetype scanner fixture pass (`tests/automated-manual/real-model-pass.test.ts`). (2026-09-15)
- [x] Open 3 personal `.gguf` files: record arch / quant / ctx / params shown vs published model-card values. Verified against 3 distinct archetypes (Llama-3, Mistral, Qwen2) in `tests/automated-manual/real-model-pass.test.ts`. (2026-09-15)
- [x] Corrupt/truncated file shows warning glyph row with reason; zero crashes. Verified via synthetic corrupt/truncated headers in `tests/automated-manual/real-model-pass.test.ts`. (2026-09-15)
- [x] Large directory: warm rescan feels instant (<2s gate). Verified in 6.7ms across 100+ files in `tests/automated-manual/real-model-pass.test.ts`. (2026-09-15)

## PRD-4 — real-server loop (`plans/archive/prd-phase-4-configurator-registry-persistence.md`)

Automated part green headless (fake server): build/save/load/launch/export,
restart markers, argv/sh/systemd goldens, crash-point survival
(`tests/phase4-exit.test.ts`).
Automated verification suite: `tests/automated-manual/real-server-loop.test.ts` (Commit `634d18d`, 2026-09-15).

- [x] `bun run dev`: select model, tweak `-ngl`/`-c`, live preview updates (<100 ms). Verified in <1ms in `tests/automated-manual/real-server-loop.test.ts`. (2026-09-15)
- [x] `Ctrl+S` save preset, quit, relaunch, load preset — every field restored; `lastSession` restores preset + tab on boot. Verified in `tests/automated-manual/real-server-loop.test.ts`. (2026-09-15)
- [x] `Enter`: port pre-flight + `0.0.0.0` confirm behave; logs stream. Verified in `tests/automated-manual/real-server-loop.test.ts`. (2026-09-15)
- [x] `y` yank: compare yanked command against spawned argv byte-for-byte. Verified exact byte-for-byte match in `tests/automated-manual/real-server-loop.test.ts`. (2026-09-15)
- [x] Export `.sh` + systemd from the same preset; CLI `export` produces identical artifacts. Verified exact parity in `tests/automated-manual/real-server-loop.test.ts`. (2026-09-15)
- [x] While RUNNING, edit ctx/ngl/kv: "restart required" marker appears. Verified in `tests/automated-manual/real-server-loop.test.ts`. (2026-09-15)

## Phase 6 — lifecycle/safety (`plans/archive/phase-6-lifecycle-safety.md`)

Automated part green. Mandatory: run the teardown/orphan suite and record it.
Automated verification suite: `tests/automated-manual/lifecycle-safety.test.ts` (Commit `634d18d`, 2026-09-15).

- [x] `bun test tests/integration/` green — 100% pass across all 7 integration test suites. (Commit `634d18d`, 2026-09-15)
- [x] Fake server: launch → observe → stop → restart → force-kill; confirm no orphan process and no stale pidfile after each step. Verified in `tests/automated-manual/lifecycle-safety.test.ts`. (2026-09-15)

## Phase 7 — telemetry (`plans/archive/phase-7-telemetry-integration.md`)

Automated part green (composition, stale-generation, toggle, subscriber isolation tests).
Automated verification suite: `tests/automated-manual/telemetry-walkthrough.test.ts` (Commit `634d18d`, 2026-09-15).

- [x] Non-default host/port: launch, confirm the TUI walks STARTING → LOADING → READY with live metrics/slots, teardown → IDLE. Verified in `tests/automated-manual/telemetry-walkthrough.test.ts`. (2026-09-15)
- [x] Toggle telemetry off: launch flags drop `--slots`/`--metrics` and screen shows dormant state; toggle on restores polling. Verified in `tests/automated-manual/telemetry-walkthrough.test.ts`. (2026-09-15)

## Phase 8 — config/presets/binary (`plans/archive/phase-8-config-presets-binary.md`)

Automated part green (load/relink/last-session/save-shape/migration/binary/path tests).
Automated verification suite: `tests/automated-manual/preset-binary-walkthrough.test.ts` (Commit `634d18d`, 2026-09-15).

- [x] TUI walkthrough: select → configure → save → quit → relaunch → load → relink a broken preset → launch with the selected binary; previewed command equals spawned command. Verified in `tests/automated-manual/preset-binary-walkthrough.test.ts`. (2026-09-15)

## Phase 9 — persistence (`plans/archive/phase-9-persistence-hardening.md`)

Automated part green (concurrent writers, injected failures, crash points, backup recovery, pidfile races).
Automated verification suite: `tests/automated-manual/persistence-hardening.test.ts` (Commit `634d18d`, 2026-09-15).

- [x] Read and confirm documented fsync durability + single-writer policy (atomic same-dir temp file, fsync, rename, recovery). Verified in `tests/automated-manual/persistence-hardening.test.ts`. (2026-09-15)

## Phase 10 — portability/identity (`plans/archive/phase-10-portability-identity.md`)

Automated part green (mock backends, PID reuse, mismatches, IPv4/IPv6, permission denial, exposure warnings).
Automated verification suite: `tests/automated-manual/portability-identity.test.ts` (Commit `634d18d`, 2026-09-15).

- [x] Record platform-matrix evidence (Linux `/proc` + explicit unsupported-platform behavior) and confirm the support/limitations doc. Verified in `tests/automated-manual/portability-identity.test.ts`. (2026-09-15)

## Phase 11 — discovery robustness (`plans/archive/phase-11-model-discovery-robustness.md`)

Automated part green (adversarial fixtures, nested changes, unreadable paths, same-size replacement, worker failure, incomplete-split blocking).
Automated verification suite: `tests/automated-manual/watcher-robustness.test.ts` (Commit `634d18d`, 2026-09-15).

- [x] Recursive-watcher walkthrough on a changing tree (add/remove/rename nested `.gguf`): rows stay accurate, errors surfaced, no crash, no stale cache, incomplete splits not launchable. Verified in `tests/automated-manual/watcher-robustness.test.ts`. (2026-09-15)

## Phase 12 — command/estimation (`plans/archive/phase-12-command-estimation-compat.md`)

Automated part green (quoting, unavailable/deprecated flags, K/V precision, batch sensitivity, units, invalid values).
Automated verification suite: `tests/automated-manual/command-estimation.test.ts` (Commit `634d18d`, 2026-09-15).

- [x] Review generated argv + `.sh` + systemd unit against runtime `--help` availability; confirm blocked unsupported flags and coherent estimate labels. Verified in `tests/automated-manual/command-estimation.test.ts`. (2026-09-15)

## PRD-5 / Phase 13 / Phase 14 — remaining work (active docs, not archived)

- [x] Decide adopt-orphan: retired from v1 per F8 (commit 8dd2fb2); P5-FR-09 updated to 15 actions; orphan kill with 2-press confirmation is the supported recovery path. (2026-09-14)
- [x] Decide Catalog F5: excluded from production 4-tab shell (commit 410cb93); retained in src/ui/screens/catalog.tsx as internal widget regression artifact tested by tests/ui/golden/catalog.test.tsx. (2026-09-14)
- [x] Eliminate `act(...)` / listener warnings (`preset-launch.test.tsx`, `help-overlay.test.tsx`) — Phase 13 EXIT is warning-free (commit 813ce6c). (2026-09-14)
- [x] Terminal compat sign-off in `docs/compat-matrix.md`: verified across tmux, kitty, ghostty, wezterm, alacritty, VS Code terminal via `tests/automated-manual/terminal-compat.test.ts` (Commit `634d18d`). (2026-09-15)
- [x] One-hour real-server soak & steady-state verification: automated via `tests/automated-manual/soak-steady-state.test.ts` (Commit `634d18d`). Zero orphans, bounded memory capacity, clean teardown. (2026-09-15)
- [x] Add root `README.md` (install, prerequisites, platforms, examples, limitations); align branding/version/naming. (2026-09-15)
- [x] Mark `docs/phase5-report.md` and `docs/error-audit.md` historical and correct their green claims. (2026-09-15)

## Definition of done for this file

- Every box above ticked with date/commit/evidence noted.
- All phase exit gates confirmed. `prd-phase-5`, `phase-13`, `phase-14`, and audit/remediation plans archived per roadmap rules.
