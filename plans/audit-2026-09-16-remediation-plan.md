# Remediation Plan — 2026-09-16 Audit

Source: repository audit of 2026-09-16 (software quality, product, UX, maintainability).
Each item is one GitHub issue ≈ one branch-sized PR per the AGENTS.md loop; issues already
carry `layer:*` / `priority:*` labels and the `ready` flag for agent pickup. Work top-to-bottom
within a stage; stages may interleave, but respect the noted dependencies.

## Stage 1 — Safety & truth (do first; all small, all currently lie to or endanger the user)

| # | Issue | Layer | Priority |
|---|-------|-------|----------|
| 1 | [#55 — `k` double-owned: table navigation arms/executes orphan kill](https://github.com/Theblackcat98/llamacpp-runner/issues/55) | ui | high |
| 2 | [#56 — FAILED rendered as "server running" (spurious quit/kill confirms)](https://github.com/Theblackcat98/llamacpp-runner/issues/56) | ui | high |
| 3 | [#58 — Ctrl+S saved preset invisible on Presets tab until restart](https://github.com/Theblackcat98/llamacpp-runner/issues/58) | ui | high |
| 4 | [#59 — corrupt presets.json silently reset & overwritten (no backup)](https://github.com/Theblackcat98/llamacpp-runner/issues/59) | core | high |
| 5 | [#57 — boot always logs false "llama-server not found on PATH"](https://github.com/Theblackcat98/llamacpp-runner/issues/57) | core | medium |

## Stage 2 — State correctness

| # | Issue | Layer | Priority |
|---|-------|-------|----------|
| 6 | [#60 — preset loads inherit wrong model metadata; rescan silently swaps model](https://github.com/Theblackcat98/llamacpp-runner/issues/60) | ui | high |
| 7 | [#61 — process & pidfile hygiene (unknown kill reason, quick presetId, clear-before-kill)](https://github.com/Theblackcat98/llamacpp-runner/issues/61) | core | medium |
| 8 | [#62 — export & clipboard hardening (OSC 52 honesty, script sanitization)](https://github.com/Theblackcat98/llamacpp-runner/issues/62) | core | medium |

## Stage 3 — Docs truth (one reconciliation branch; no code risk, high credibility value)

| # | Issue | Layer | Priority |
|---|-------|-------|----------|
| 9 | [#63 — reconcile spec & docs with reality (sign-off contradiction, D3 PTY, theme list, stale rows)](https://github.com/Theblackcat98/llamacpp-runner/issues/63) | docs | medium |

## Stage 4 — Feature truth (machinery exists, product surface doesn't)

| # | Issue | Layer | Priority |
|---|-------|-------|----------|
| 10 | [#64 — wire or remove dead machinery (VRAM calibration, preset last_used)](https://github.com/Theblackcat98/llamacpp-runner/issues/64) | ui | medium |
| 11 | [#65 — Configurator capability surfacing (§7 row 8)](https://github.com/Theblackcat98/llamacpp-runner/issues/65) | ui | medium |
| 12 | [#66 — hardware reprobe action + honest no-GPU messaging](https://github.com/Theblackcat98/llamacpp-runner/issues/66) | ui | medium |
| 13 | [#68 — live \r loading progress in the console drawer (§2.5)](https://github.com/Theblackcat98/llamacpp-runner/issues/68) | core→ui | medium |

## Stage 5 — UX consistency

| # | Issue | Layer | Priority |
|---|-------|-------|----------|
| 14 | [#67 — UX consistency pass (explorer preview, set-port, Esc arm, labels, modal state, port validation)](https://github.com/Theblackcat98/llamacpp-runner/issues/67) | ui | medium |

## Stage 6 — Structural (after behavior is pinned green by Stages 1–2 tests)

| # | Issue | Layer | Priority |
|---|-------|-------|----------|
| 15 | [#69 — config ownership consolidation + `llama-deck config` setter + ~/.configs precedence](https://github.com/Theblackcat98/llamacpp-runner/issues/69) | core(+cli) | medium |
| 16 | [#70 — decompose SessionApp into hooks; fix telemetry service churn](https://github.com/Theblackcat98/llamacpp-runner/issues/70) | ui | medium |
| 17 | [#71 — dead-code sweep (core branch, then ui branch)](https://github.com/Theblackcat98/llamacpp-runner/issues/71) | core+ui | low |

## Dependencies & ordering notes

- **#70 depends on #58/#60** landing first (or at least their e2e pinning tests): the refactor
  must be green-to-green against the fixed behaviors.
- **#64's calibration wiring** should coordinate with **#70** (the telemetry service lifecycle
  changes where `onRunEnd` fires); if #64 chooses "remove", it is independent.
- **#71** keeps/deletes `UNAVAILABLE_HINT` based on the outcome of **#65** — do #65 first.
- **#68** is two branches by design (core accessor, then ui rendering) per the layer rule;
  **#71** likewise lands core before ui.
- **#63** can proceed any time and unblocks honest release claims (manual terminal-matrix
  sign-off recorded, or claims downgraded).
