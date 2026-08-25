# Error & Edge State Audit — spec §7 (P5-FR-08)

Every row of the §7 error-state inventory mapped to its owning component and
its verification: an automated test, or a scripted/manual check. This table
is part of the Phase 5 EXIT criterion ("full error table green").

| # | State (§7)                    | Detection (owner)                        | Handling                                            | Verification |
|---|-------------------------------|------------------------------------------|-----------------------------------------------------|--------------|
| 1 | Port in use                   | Pre-flight bind check (`core/process/preflight`, supervisor) | Error + suggest next free port; launch blocked      | AUTO `tests/preflight.test.ts` · `tests/integration/supervisor.test.ts` ("port_in_use") · `tests/integration/launch-guards.test.ts` |
| 2 | VRAM OOM at load              | Exit code + log pattern (`core/telemetry/failure-classifier`) | FAILED + suggest lower ngl/ctx/KV quant             | AUTO `tests/failure-classifier.test.ts` · `tests/integration/session-failure.test.ts` (FAILURE_CLASSIFIED over bus) |
| 3 | Model file missing/changed    | Scanner/fs watcher + preset relink       | Preset marked BROKEN; re-link prompt                | AUTO `tests/ui/presets-state.test.ts` ("marks presets ... broken", relink) · `tests/fs-watcher.test.ts` · `tests/models-service.test.ts` |
| 4 | Corrupt GGUF (bad magic)      | GGUF parser                              | Flagged row in table; scanner never crashes         | AUTO `tests/gguf-parser.test.ts` · golden `tests/ui/golden/explorer-corrupt-row.framesnap` |
| 5 | Multi-part GGUF               | Filename pattern (`split-grouping`)      | Grouped; summed size; metadata from part 1          | AUTO `tests/split-grouping.test.ts` · `tests/gguf-fixtures.test.ts` |
| 6 | First run, no models dir      | Startup: configured dir null             | Onboarding prompt ([s] default dir / scan cmd)      | AUTO `tests/ui/first-run.test.tsx` + golden `explorer-first-run.framesnap` |
| 7 | llama-server not on PATH      | Startup `which`; supervisor spawn check  | Warning at boot; FAILED binary_not_found, no spawn  | AUTO `tests/integration/supervisor.test.ts` ("missing binary reports binary_not_found") |
| 8 | Binary too old for a flag     | `--help` parse vs registry (`flags/validate`) | Flag disabled in UI with tooltip; deprecated warn   | AUTO `tests/help-parser.test.ts` (incl. "§7 binary-too-old row") · `tests/binary-validation.test.ts` |
| 9 | Terminal below 100x30         | Resize event (`ui/logic/layout-state`)   | Degraded single-column + resize hint, no overlap    | AUTO `tests/layout-state.test.ts` · `tests/ui/degraded-layout.test.tsx` |
| 10| TUI crash mid-session         | Exit hooks (SIGINT/TERM/HUP/uncaught)    | Same idempotent teardown (§6.2); pidfile recovery   | AUTO `tests/integration/orphan.test.ts` · `tests/integration/session.test.ts` · `tests/integration/supervisor.test.ts` teardown suite |
| 11| Split-file sibling deleted    | Scanner grouping                         | Group marked incomplete                             | AUTO `tests/scanner.test.ts` ("marks a group incomplete...") · `tests/split-grouping.test.ts` |

Status: **11/11 rows verified green** — no skipped or pending tests.

## Manual checks (per phase exit, not per commit)

- Terminal compat matrix: see `docs/compat-matrix.md` (release gate).
- 1-hour soak with real llama-server + telemetry: script
  `scripts/soak-check.sh` (Phase 5 exit gate); verify no orphan
  (`pgrep llama-server`), sane VRAM vs `nvidia-smi`, no UI freeze.
