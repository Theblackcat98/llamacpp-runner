PRD — Phase 1: Walking Skeleton + Safety Net
llama-deck · Document: plans/prd-phase-1-walking-skeleton.md · Spec ref: llamamanager.md §9 Phase 1

 1. Summary

 Establish the end-to-end vertical slice: a Bun + OpenTUI application shell that spawns a
 real llama-server process (hardcoded model), streams its logs through a PTY + line
 assembler into a console drawer, and — critically — can never leave an orphaned process
 behind. This phase exists to prove the architecture (§1.1), de-risk the runtime (Bun/FFI/
 node-pty), and install the process-safety net that every later phase depends on.

 2. Goals

  * Runnable app skeleton: header, 4 tabs (empty), status bar, console drawer.
  * Headless core package exists with zero UI imports; typed event bus operational.
  * Supervisor: spawn → stream → teardown, with \r line assembly.
  * Full crash-safe teardown (exit hooks, pidfile, orphan recovery).
  * Theme token pipeline from plans/opentui.html CSS variables.

 3. Non-Goals (explicitly out of scope)

  * No model discovery, GGUF parsing, configurator, presets, or telemetry.
  * No widget library beyond what the shell itself needs (plain boxes/text).
  * No multi-instance support (v1 = exactly one managed instance, D4).
  * No theming UI — Tokyo Night hardcoded; provider interface only.

 4. User Stories

  * As a developer, I launch the app, see a hardcoded preset start a real llama-server,
    watch its loading progress render cleanly in the log drawer, quit with Ctrl+C, and
    verify zero processes remain (`ps aux | grep llama-server`).
  * As a developer, I SIGKILL the TUI mid-load and re-launch; the app detects the orphan
    via pidfile and offers to kill it.
  * As a user, llama-server's \r-based progress bar updates in place instead of flooding
    the log with hundreds of lines.

 5. Functional Requirements

  | ID       | Requirement                                                        | Spec    |
  |----------|--------------------------------------------------------------------|---------|
  | P1-FR-01 | App boots under pinned Bun version via `bun run` with packageManager pin | §1.3 |
  | P1-FR-02 | Shell renders: header bar, 4 placeholder tabs, status bar, collapsible console drawer | §2 |
  | P1-FR-03 | Tab keys 1–4 switch views; Tab/Shift+Tab cycles focus; Ctrl+C and q quit through the SAME teardown path | §4 |
  | P1-FR-04 | Core lives in src/core with zero imports from src/ui (enforced by lint/CI boundary rule) | §1.1 |
  | P1-FR-05 | Typed event bus: intents (e.g. LAUNCH, QUIT) flow UI→core; state (LOG_LINE, PROC_STATE) flows core→UI | §1.1 |
  | P1-FR-06 | Supervisor spawns llama-server via node-pty (detached:false, shared process group) with plain-pipe fallback if PTY unavailable | §6.1, D3 |
  | P1-FR-07 | Hardcoded launch config (model path, port, -ngl) — constants, no UI to change them | §9 |
  | P1-FR-08 | \r line assembler: carriage-return sequences replace the current in-progress line; assembled lines enter a ring buffer bounded at 10,000 lines | §2.5 |
  | P1-FR-09 | ANSI escape sequences in log output are preserved and rendered in the drawer | §2.5 |
  | P1-FR-10 | Drawer autoscrolls; pauses on user scroll-up; resumes on G/End | §2.5 |
  | P1-FR-11 | Teardown path: SIGINT → wait ≤5 s → SIGKILL; idempotent (safe to call twice) | §6.2 |
  | P1-FR-12 | Exit hooks registered at startup: SIGINT, SIGTERM, SIGHUP, uncaughtException, unhandledRejection, beforeExit — all run the same idempotent teardown | §6.2 |
  | P1-FR-13 | Spawn/kill race guard: teardown begun during spawn waits for the process handle before signaling | §6.2 |
  | P1-FR-14 | Pidfile written to $XDG_STATE_HOME/llama-deck/server.pid containing { pid, port, preset_id, started_at } | §6.3 |
  | P1-FR-15 | On startup: if pidfile exists, verify /proc/<pid> alive AND cmdline contains llama-server, probe recorded port; offer adopt or kill; stale pidfiles cleaned silently | §6.3 |
  | P1-FR-16 | Proc state machine emits STARTING → LOADING | READY | FAILED (exit-code driven at this phase; /health arrives in Phase 5) | §3.5 |
  | P1-FR-17 | Non-zero exit → FAILED state; last 50 log lines surfaced to the UI | §6.4 |
  | P1-FR-18 | Theme tokens (colors only) extracted from opentui.html :root variables into a typed theme module | §2.1 |
  | P1-FR-19 | State (never config) written under $XDG_STATE_HOME/llama-deck/; config dir created but unused this phase | §5 |

 6. Non-Functional Requirements

  | ID        | Requirement                                                         |
  |-----------|----------------------------------------------------------------------|
  | P1-NFR-01 | Log path (PTY → assembler → ring buffer → render) sustains llama.cpp's load-time output without frame drops or UI freeze |
  | P1-NFR-02 | Ring buffer memory bounded (10k lines) regardless of child verbosity |
  | P1-NFR-03 | Teardown completes ≤5 s in the normal case; ≤7 s worst case (SIGKILL path) |
  | P1-NFR-04 | App renders in a 100x30 terminal without overlap (degraded mode may activate below) |
  | P1-NFR-05 | node-pty verified working under Bun; documented fallback trigger if not |

 7. Deliverables

  * Repository scaffold: package.json (pinned Bun), src/core/*, src/ui/*, tests/*.
  * Core modules: bus.ts, process/supervisor.ts, process/line-assembler.ts,
    process/ring-buffer.ts, process/cleanup.ts, store/state-paths.ts.
  * UI shell: app.tsx, shell components, console drawer.
  * tests/fixtures/fake-server.sh (see §8) — reused by every later phase.
  * CI: lint (incl. core/ui boundary rule), typecheck, test.

 8. Verification & Test Plan

  | Target                     | Method                                                                 |
  |----------------------------|-------------------------------------------------------------------------|
  | Line assembler             | Unit: inputs ["load 10%\r", "load 50%\r", "done\n"] → 2 lines; mixed ANSI retained |
  | Ring buffer                | Unit: bounded at 10k, oldest evicted                                    |
  | Teardown hooks             | Integration: spawn fake-server.sh; send each signal; assert process reaped |
  | Orphan recovery            | Integration: write pidfile manually + start stray fake-server.sh; relaunch app; assert adopt/kill prompt; assert stale pidfile (random pid) cleaned silently |
  | Spawn/kill race            | Integration: trigger QUIT during fake-server startup window             |
  | End-to-end manual          | Launch with a REAL llama-server + small model; observe \r progress; quit; `pgrep -f llama-server` empty |
  | Boundary rule              | CI grep/import-lint: src/core contains no src/ui imports                |

 9. Dependencies & Integration Points

  * Upstream: none (first phase).
  * Provides to later phases: bus contract (intent/state event names are now frozen),
    supervisor API (spawn/kill/adopt), line assembler, fake-server.sh fixture,
    teardown net (all phases inherit safety), theme token module.

 10. Acceptance Criteria (Phase Gate)

  * [ ] All P1-FR-01..19 implemented and verified per §8.
  * [ ] EXIT CRITERION (spec §9): launch → watch logs → quit → zero orphaned processes,
        verified manually with a real llama-server AND automated with fake-server.sh.
  * [ ] Kill -9 on the TUI mid-load leaves no zombie after relaunch adopts/kills it.
  * [ ] CI green: lint + typecheck + unit + integration suites.

 11. Risks

  | Risk                                    | Mitigation                                              |
  |-----------------------------------------|---------------------------------------------------------|
  | node-pty incompatible with Bun FFI      | Pipe fallback (P1-FR-06); decide D3 pivot early         |
  | OpenTUI alpha breaking changes          | Headless core isolates domain logic (D5); pin version   |
  | \r handling edge cases (bare \r, \r\n)  | Table-driven unit tests; fixture covers real captures   |
  | Pidfile false positives (pid reuse)     | cmdline verification is mandatory, not just pid liveness |
