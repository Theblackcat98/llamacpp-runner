> Archive note (2026-09-11): automated acceptance green; manual checks tracked in plans/manual-verification-checklist.md — tick boxes there, not here.

PRD — Phase 4: Configurator, Registry & Persistence
llama-deck · Document: plans/archive/prd-phase-4-configurator-registry-persistence.md · Spec ref: llamamanager.md §9 Phase 4

 1. Summary

 Turn metadata into launchable configuration: the flag registry as single source of truth
 for every llama-server flag, the live command preview and exporters (clipboard / .sh /
 systemd), the Configurator screen built from Phase 2 widgets, and the preset store with
 atomic writes and migrations. This phase connects Explorer data → buildable commands →
 Phase 1's supervisor: first real "pick model, configure, launch, export" loop.

 2. Goals

  * Flag registry driving form widgets, preview, and exporters — no scattered CLI strings.
  * Runtime validation against the user's actual llama-server (--help parse).
  * Configurator screen with live preview + VRAM readout + restart-required markers.
  * Preset CRUD: atomic JSON store, schema v2, forward migrations, round-trip safety.
  * Port pre-flight check and 0.0.0.0 confirmation before spawn.

 3. Non-Goals

  * No telemetry screens (Phase 5) though --slots/--metrics flags are injected.
  * No multi-instance, no scheduling, no remote hosts.
  * No palette completion (Phase 5 wires full action registry).

 4. User Stories

  * As a user, I select a model, adjust -ngl/-c/KV precision, and watch the exact
    llama-server command update live with my VRAM estimate changing accordingly.
  * As a user, I press Enter and llama-deck checks the port is free, warns me about
    0.0.0.0, launches, and starts streaming logs — the walking skeleton now driven by
    real configuration.
  * As a user, I save the config as a preset (Ctrl+S), restart the app, and load it again;
    my file on disk is hand-editable JSON that round-trips unknown flags.
  * As a user, I export the command to my clipboard (OSC 52, works over SSH), or generate
    a .sh script or systemd unit from the same preset.
  * As a user with an older llama-server binary, flags my binary doesn't support are
    disabled with an explanatory tooltip instead of producing a broken command.

 5. Functional Requirements

  | ID       | Requirement                                                            | Spec    |
  |----------|------------------------------------------------------------------------|---------|
  | P4-FR-01 | Flag registry entry shape: { id, cli[], type, min, max ("meta:" refs allowed), default, since, deprecated, ui{widget,label} }; registry is data, not code paths | §3.3 |
  | P4-FR-02 | Registry covers at launch: n_gpu_layers, ctx_size, batch_size, ubatch_size, threads, flash_attn, mlock, no_mmap, cache_type_k, cache_type_v, host, port, chat_template, slots, metrics, alias | §2.3, §3.3 |
  | P4-FR-03 | Command builder consumes (registry + model metadata + user values) → deterministic argv; meta: refs resolve against selected model (e.g., max ngl = block_count+1) | §3.3 |
  | P4-FR-04 | Runtime validation: parse `llama-server --help` on startup/binary-change; flags absent from binary are disabled in UI with tooltip; deprecated flags render warnings | §3.3 |
  | P4-FR-05 | "Binary not on PATH" → prompt for binary path, persisted; registry idles until resolved | §7 |
  | P4-FR-06 | Live command preview strip: syntax-highlighted, updates on every value change | §2.2 |
  | P4-FR-07 | Estimator wiring: slider/ctx/KV changes re-run Phase 3 estimator; range shown in-configurator | §3.2, §2.3 |
  | P4-FR-08 | ctx input clamped to {arch}.context_length with explicit warning on exceed; preset chips 4096..131072 | §2.3 |
  | P4-FR-09 | host=0.0.0.0 triggers confirm dialog before any launch; default 127.0.0.1 | §2.3 |
  | P4-FR-10 | Pre-flight port bind check before spawn; conflict → error + suggest next free port | §3.4, §7 |
  | P4-FR-11 | Telemetry pair --slots/--metrics auto-injected while telemetry enabled (default ON); reflected in preview | §3.5 |
  | P4-FR-12 | Restart-required semantics: edits to model/ctx/ngl/kv after a running launch are marked "restart required"; no implied hot-swap | §3.4 |
  | P4-FR-13 | Preset store at $XDG_CONFIG_HOME/llama-deck/presets.json, schema v2 exactly per spec §5 (incl. lastSession, created_at, last_used) | §5 |
  | P4-FR-14 | Atomic writes: temp file + rename in same dir; .bak written on migration; forward-only migrations keyed by version field | §5 |
  | P4-FR-15 | Unknown flags in a preset file are preserved verbatim on save (round-trip safe) and flagged in UI | §5 |
  | P4-FR-16 | Exporters: (a) clipboard via OSC 52 with xclip/xsel/wl-copy/pbcopy fallback (D6); (b) .sh script with env vars + exec; (c) systemd unit (Type=simple, Restart=on-failure, ExecStart) | §3.3 |
  | P4-FR-17 | Configurator screen assembled exclusively from Phase 2 widgets per mockup tab [5]; actions: Enter=Save&Launch, Ctrl+S=Save Preset, Esc=Reset, y=Yank | §2.3, §4 |
  | P4-FR-18 | Preset model file missing/changed → preset marked broken with re-link prompt | §7 |
  | P4-FR-19 | Presets screen (tab 4): list, clone, delete, set-default; lastSession restores last preset+tab on boot | §5, §2 |
  | P4-FR-20 | Exactly one managed instance enforced: second launch attempt while running → prompt (stop current / cancel) | §3.4, D4 |

 6. Non-Functional Requirements

  | ID        | Requirement                                                         |
  |-----------|----------------------------------------------------------------------|
  | P4-NFR-01 | Command builder deterministic: same inputs → byte-identical argv (golden tests) |
  | P4-NFR-02 | Preset save never truncates the file on crash mid-write (atomicity test with injected rename failure) |
  | P4-NFR-03 | --help parse tolerant to llama-server output format drift (unknown lines ignored, never fatal) |
  | P4-NFR-04 | Preview updates <100 ms after any control change                     |

 7. Deliverables

  * src/core/flags/: registry.ts (data), builder.ts, help-parser.ts.
  * src/core/store/: presets.ts, migrations.ts, schema.preset.json.
  * src/core/export/: clipboard.ts (OSC 52 + fallbacks), sh.ts, systemd.ts.
  * src/ui/screens/configurator.tsx, presets.tsx.
  * tests: builder golden suite, help-parser fixtures (2–3 real --help captures across
    versions), store migration/atomicity suite, exporter golden files.

 8. Verification & Test Plan

  | Target             | Method                                                                   |
  |--------------------|---------------------------------------------------------------------------|
  | Command builder    | Golden argv tests per archetype (full offload / low-VRAM / CPU-only)     |
  | Help parser        | Real captured --help outputs → expected flag availability maps           |
  | Registry drift     | Fixture with deprecated flag → UI warning path; absent flag → disabled path |
  | Preset store       | v1→v2 migration fixture; unknown-flag round-trip; atomicity under injected failure (P4-NFR-02) |
  | Port pre-flight    | Integration: bind a socket first → launch attempt yields error + suggestion |
  | 0.0.0.0 guard      | Integration: confirm dialog blocks spawn until acknowledged              |
  | Exporters          | Golden .sh and systemd outputs; clipboard path tested via injected OSC writer + fallback stubs |
  | End-to-end         | Manual: build → save → launch (fake + real server) → export all 3 ways    |
  | Restart-required   | UI state test: mutate ctx while RUNNING → marker appears                 |

 9. Dependencies & Integration Points

  * Upstream: Phase 1 (supervisor spawn, teardown), Phase 2 (form widgets), Phase 3
    (model metadata for meta: refs, estimator).
  * Provides to Phase 5: validated launch pipeline (Phase 5 adds health/slots/metrics on
    top), preset store (CLI reuses), exporters (CLI `export` reuses).

 10. Acceptance Criteria (Phase Gate)

  * [ ] All P4-FR-01..20 implemented and verified per §8.
  * [ ] EXIT CRITERION (spec §9): build, save, launch, and export a preset; restart-
        required markers behave per §3.4.
  * [ ] Golden suites green (argv, sh, systemd); store survives injected crash points.
  * [ ] Manual loop with real llama-server: configure → Enter → logs stream → yank
        command matches the actually spawned argv byte-for-byte.

 11. Risks

  | Risk                                        | Mitigation                                        |
  |---------------------------------------------|----------------------------------------------------|
  | Flag drift outpacing registry maintenance   | --help runtime validation is the safety net (D9); registry data-only edits |
  | chat-template value space churn             | Ship curated list + free-text entry; validate against --help |
  | Atomicity edge cases on exotic FS           | Same-dir rename; document NFS caveat               |
  | OSC 52 unsupported in some terminals        | Fallback chain (D6) + graceful notice on failure   |
