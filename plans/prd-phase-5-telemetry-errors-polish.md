PRD — Phase 5: Telemetry, Errors & Polish
llama-deck · Document: plans/prd-phase-5-telemetry-errors-polish.md · Spec ref: llamamanager.md §9 Phase 5

 1. Summary

 Close the loop with live server intelligence and production hardening: the /health-driven
 state machine, /slots and /metrics (Prometheus) scraping on the Telemetry screen, the full
 error-state inventory from spec §7, command palette completion, the terminal compatibility
 matrix, and the CLI frontend. This phase turns a working manager into a trustworthy one.

 2. Goals

  * Health/slots/metrics telemetry with correct prerequisite flags.
  * Telemetry screen per mockup tab [6]: status header, gauges, sparklines, slots table.
  * Every row of the §7 error table implemented, detectable, and actionable.
  * Command palette over the complete action registry.
  * CLI: start / export / scan / list / kill sharing the headless core.
  * Terminal compat matrix signed off.

 3. Non-Goals

  * No multi-instance orchestration.
  * No remote/SSH server management (OSC 52 clipboard works over SSH; that is all).
  * No in-app model downloads.
  * No theming UI beyond palette entry (5 themes shipped in Phase 2).

 4. User Stories

  * As a user, I watch the status badge move STARTING → LOADING → READY without touching
    anything, then see decode t/s and KV utilization update live.
  * As a user, I open the palette (Ctrl+P), type "kill", and see "Kill Current Server"
    alongside every other action — keyboard-only operation is complete.
  * As a user, when the server dies with a CUDA OOM, the app tells me WHAT failed and
    suggests lowering -ngl/-c or KV quantization.
  * As a sysadmin, I run `llama-deck start coding --format systemd` in a script and get
    the same unit file the TUI would export.
  * As a user on tmux/kitty/ghostty, everything renders identically per the compat matrix.

 5. Functional Requirements

  | ID       | Requirement                                                            | Spec    |
  |----------|------------------------------------------------------------------------|---------|
  | P5-FR-01 | /health poll (2 s): 200 → READY, 503 → LOADING; combined with exit-code watch and log markers completes STARTING → LOADING → READY \| FAILED | §3.5 |
  | P5-FR-02 | /slots poll (5 s): slot id, state, prompt tokens, generating flag; rendered in slots table | §2.4, §3.5 |
  | P5-FR-03 | /metrics scrape: parse Prometheus text (llamacpp:* series) for prompt/decode t/s and KV cache utilization; tokens/sec NEVER parsed from log lines | §3.5 |
  | P5-FR-04 | Telemetry screen: status header (badge, model, uptime, endpoint), VRAM actual-vs-estimated gauge, KV ratio gauge, prompt/decode t/s sparklines with history, slots table | §2.4 |
  | P5-FR-05 | Sparkline history ring (block-fill glyphs ▁▂▃▅▇) per metric | §2.4 |
  | P5-FR-06 | Telemetry prerequisite flags (--slots/--metrics) verified present at launch; if user disabled telemetry, screen shows dormant state with enable action | §3.5 |
  | P5-FR-07 | Failure classification: exit code + log patterns for CUDA OOM, port bind failure, missing model file; each presents a suggested fix (lower ngl/ctx/kv-quant, free port, re-link) | §6.4 |
  | P5-FR-08 | Error-state inventory §7 fully implemented: port in use, VRAM OOM, model missing/changed, corrupt GGUF (P3), multi-part (P3), first-run (P3), binary missing (P4), binary too old (P4), below 100x30 (P1), TUI crash recovery (P1), split sibling deleted (P3) — audit table in repo, each row → test or manual script | §7 |
  | P5-FR-09 | Command palette: fuzzy search over complete action registry (switch theme ×5, set port, kill server, export command, rescan models, adopt orphan, toggle telemetry, go to tab 1–4, clear log) | §2.6 |
  | P5-FR-10 | Palette uses Phase 2 modal focus capture; Esc closes; Ctrl+P toggles | §2.6, P2-FR-13 |
  | P5-FR-11 | Ctrl+C final semantics: quit + teardown; confirmation when server running; second press within 2 s force-quits; x = explicit kill with confirmation | §4 |
  | P5-FR-12 | CLI: `llama-deck start <preset>` (headless run: spawn + tail logs + teardown on signal), `export <preset> --format sh|systemd|cmd`, `scan` (rebuild cache), `list` (models/presets), `kill` (pidfile-aware) | §1.1 |
  | P5-FR-13 | CLI shares core exclusively — no duplicated domain logic; `--json` output modes for scripting | §1.1 |
  | P5-FR-14 | Degraded-mode polish: below 100x30, single column + resize hint, no overlapping renders on resize churn (debounced relayout) | §2.1 |
  | P5-FR-15 | Uptime clock, endpoint URL display, and last-50-error-lines surface on FAILED | §2.4, §6.4 |

 6. Non-Functional Requirements

  | ID        | Requirement                                                        |
  |-----------|---------------------------------------------------------------------|
  | P5-NFR-01 | Pollers never block the render loop; HTTP timeouts 2 s with backoff on failure |
  | P5-NFR-02 | Telemetry screen paint budget <100 ms per update tick               |
  | P5-NFR-03 | CLI startup-to-action <300 ms (no TUI initialization on CLI paths)  |
  | P5-NFR-04 | Memory steady-state: 1 h session with active telemetry shows no unbounded growth (history rings capped) |

 7. Deliverables

  * src/core/telemetry/: health.ts, slots.ts, metrics.ts, state-machine.ts.
  * src/ui/screens/telemetry.tsx; palette.tsx + action registry.
  * src/cli.ts + subcommands.
  * docs/compat-matrix.md + completed audit table for §7.
  * tests: mock HTTP server fixtures (canned /health, /slots, /metrics incl. malformed),
    state-machine transitions, CLI integration tests.

 8. Verification & Test Plan

  | Target              | Method                                                                     |
  |---------------------|-----------------------------------------------------------------------------|
  | State machine       | Integration vs fake-server.sh extended with 503→200 /health; assert badge timeline |
  | /metrics parsing    | Unit: real captured Prometheus payloads + malformed/truncated variants      |
  | /slots rendering    | Unit + golden frames for ACTIVE/IDLE slot states                           |
  | Failure classifier  | Fixture logs: CUDA OOM, bind failure, missing file → correct class + suggestion |
  | §7 audit            | Every row linked to an automated test or scripted manual check; matrix in repo |
  | Palette             | Fuzzy-filter tests; focus capture; action coverage vs registry enumeration  |
  | Ctrl+C semantics    | Integration: running server → confirm flow; double-press force path          |
  | CLI                 | Integration: start+kill cycle (fake server), export golden outputs, scan/list JSON schema |
  | Compat matrix       | Manual checklist: tmux, kitty, ghostty, wezterm, alacritty, VSCode terminal — braille width, box glyphs, OSC 52, truecolor; sign-off recorded |
  | Perf                | P5-NFR-02/03/04 measured and recorded                                       |

 9. Dependencies & Integration Points

  * Upstream: all prior phases (supervisor + safety net, widgets, model data, launch
    pipeline + presets/exporters).
  * Provides: v1.0.0 release candidate. Post-v1 backlog seeds: multi-instance, remote
    hosts, model downloads, mouse support.

 10. Acceptance Criteria (Phase Gate)

  * [ ] All P5-FR-01..15 implemented and verified per §8.
  * [ ] EXIT CRITERION (spec §9): full error table green; compat checklist signed off.
  * [ ] 1-hour soak: real llama-server + active telemetry — no orphan, no leak, no UI
        freeze; telemetry values sane vs `nvidia-smi`/`/metrics` ground truth.
  * [ ] CLI + TUI produce identical export artifacts from the same preset.

 11. Risks

  | Risk                                        | Mitigation                                          |
  |---------------------------------------------|------------------------------------------------------|
  | /metrics series churn across llama.cpp versions | Parser keyed on metric-name prefixes with strict-unknown tolerance |
  | Terminal quirks discovered late             | Compat matrix is a release gate, not a nice-to-have   |
  | Palette scope creep                         | Action registry fixed list per P5-FR-09; additions are backlog |
  | Headless CLI signal handling divergence     | CLI reuses the same teardown module as TUI (single code path) |
