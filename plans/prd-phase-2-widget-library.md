PRD — Phase 2: Widget Library
llama-deck · Document: plans/prd-phase-2-widget-library.md · Spec ref: llamamanager.md §9 Phase 2

 1. Summary

 Build the widget library that OpenTUI does not ship: sliders, checkboxes, text inputs
 with cursor management, cycling selects, preset chips, virtualized tables, scrollable
 panes, gauges/sparklines, and the cross-pane focus engine. Per spec §1.2 this is "the
 hidden 60% of the project" — every later screen is assembled from these primitives.
 The acceptance test is objective: reproduce the Components Catalog (opentui.html tab 1)
 cell-for-cell in the terminal.

 2. Goals

  * Complete widget set covering every control named in spec §2.2–2.6.
  * Cross-pane focus engine with correct normal-mode vs input-mode key routing.
  * Theme provider with all 5 themes; runtime switching.
  * Golden-frame test harness so widget regressions are caught automatically.

 3. Non-Goals

  * No domain logic: widgets receive props/callbacks only (no core imports beyond types).
  * No GGUF data, no real telemetry — demo data drives the catalog screen.
  * No command palette yet (arrives Phase 5 with complete action registry).
  * No mouse support (deferred; decision recorded, not assumed).

 4. User Stories

  * As a user, I Tab through every pane/widget in a predictable order and the focused
    element is visually unambiguous (focus token from the design system).
  * As a user, I type in a text input; j/k/arrows move the cursor instead of navigating
    the table; Esc returns me to normal mode.
  * As a user, I scroll a 500-row table smoothly; rendering stays fast because only the
    visible window is laid out.
  * As a developer, I switch themes via the provider and every widget re-renders with the
    new palette with no hardcoded colors leaking through.

 5. Functional Requirements

  | ID       | Requirement                                                            | Spec    |
  |----------|------------------------------------------------------------------------|---------|
  | P2-FR-01 | TextInput widget: printable chars, Backspace/Delete, Left/Right/Home/End cursor movement, visible cursor glyph, insert/overwrite toggle, max-length + numeric mode | §2.3 |
  | P2-FR-02 | Slider widget: min/max/value, Left/Right ±1, Shift+Left/Right ±10, Home/End min/max, numeric readout, filled-track rendering (█/░) | §2.3 |
  | P2-FR-03 | Checkbox widget: [x]/[ ] glyphs, Space toggles, focus ring              | §2.3 |
  | P2-FR-04 | CyclingSelect widget: <-/-> cycles options, wraps, renders current value | §2.3 |
  | P2-FR-05 | ChipGroup widget: row of selectable chips, exactly-one active, click/Enter selects | §2.3 |
  | P2-FR-06 | VirtualizedTable widget: columns with per-column width/align, row selection (j/k/arrows), renders ONLY the visible window, header row, optional row focus callback | §2.2 |
  | P2-FR-07 | ScrollPane widget: bounded viewport, j/k/arrows/PgUp/PgDn/g/G scrolling, sticky-bottom autoscroll that pauses on upward scroll and resumes on G/End | §2.5 |
  | P2-FR-08 | Box container API: borderStyle single/double/round/heavy, box-title overlay, accent variant — parity with design-system mockup classes | §2 (mockup) |
  | P2-FR-09 | Text primitives: bold/dim/italic/underline/inverse modifiers, truecolor foreground/background tokens | §2.1 |
  | P2-FR-10 | Gauge widget: labeled [████░░░░] bar with value clamp, plus block-fill spectrum (▁▂▃▅▇ sparkline) variant | §2.4 |
  | P2-FR-11 | Spinner: braille + quadrant-block + ASCII line frames only (emoji prohibited, D8) | §2.1 |
  | P2-FR-12 | Badge widget: ●/▲/✖ status vocabulary with blink option                  | §2.4 |
  | P2-FR-13 | Focus engine: registry-driven focus order, Tab/Shift+Tab traversal, modal focus capture (used later by palette), normal-mode global keys vs input-mode capture, focus-change event | §4 |
  | P2-FR-14 | Theme provider: 5 themes (Tokyo Night default, Catppuccin, Gruvbox, Cyberpunk, Matrix), tokens exactly from opentui.html CSS variables, runtime switch re-renders all widgets | §2.1 |
  | P2-FR-15 | Catalog screen in-app reproducing opentui.html tab [1]: borders, typography panel, data table with demo rows, tree + syntax-highlight panes | §9 exit |
  | P2-FR-16 | Every widget is prop-driven and theme-aware; zero hardcoded color literals in widget code (lint rule) | §2.1 |

 6. Non-Functional Requirements

  | ID        | Requirement                                                          |
  |-----------|-----------------------------------------------------------------------|
  | P2-NFR-01 | VirtualizedTable with 10,000 demo rows: keystroke-to-paint <50 ms     |
  | P2-NFR-02 | All widgets render correctly at 100x30 minimum viewport (no overlap)  |
  | P2-NFR-03 | Widget library imports nothing from src/core (pure presentation)      |
  | P2-NFR-04 | Golden frame snapshots stable across runs on same terminal profile    |

 7. Deliverables

  * src/ui/components/: text-input.ts, slider.ts, checkbox.ts, cycling-select.ts,
    chip-group.ts, table.ts, scroll-pane.ts, box.ts, text.ts, gauge.ts, spinner.ts, badge.ts.
  * src/ui/focus/engine.ts.
  * src/ui/themes/: tokens.ts + 5 theme definitions.
  * src/ui/screens/catalog.tsx (components catalog demo screen).
  * tests/ui/golden/*.framesnap + harness.

 8. Verification & Test Plan

  | Target            | Method                                                                    |
  |-------------------|----------------------------------------------------------------------------|
  | Each widget       | Golden-frame snapshot per theme; interaction tests (key sequence → state)  |
  | TextInput         | Property-ish tests: random key sequences never corrupt buffer/cursor invariants (cursor ∈ [0, len]) |
  | VirtualizedTable  | Perf test: 10k rows navigate top/bottom under NFR-01 budget               |
  | Focus engine      | Traversal-order tests; input-mode capture tests (typing 'j' in input does not move table) |
  | Theme switch      | Snapshot set × 5 themes; hardcoded-color lint gate = 0 violations          |
  | Catalog parity    | Side-by-side manual review vs opentui.html tab [1]; sign-off checklist    |
  | Autoscroll        | Interaction test per P2-FR-07 including focus-change interplay (spec §2.5 known subtle case) |

 9. Dependencies & Integration Points

  * Upstream: Phase 1 (theme token module, shell tabs host the catalog screen, bus for
    focus/theme events).
  * Provides: the entire component vocabulary for Phases 3–5 screens (Explorer table +
    metadata panes, Configurator form controls, Telemetry gauges/sparklines/slots table,
    palette modal via focus capture).

 10. Acceptance Criteria (Phase Gate)

  * [ ] All P2-FR-01..16 implemented and verified per §8.
  * [ ] EXIT CRITERION (spec §9): Components Catalog reproduced cell-for-cell in the
        terminal (braille spinners, all 4 border styles, table, tree, syntax colors).
  * [ ] Golden-frame suite green across 5 themes.
  * [ ] Perf budget met (P2-NFR-01).

 11. Risks

  | Risk                                       | Mitigation                                          |
  |--------------------------------------------|------------------------------------------------------|
  | OpenTUI missing primitives (e.g., no cursor API) | Spike in week 1 of phase; fall back to custom glyph rendering |
  | Snapshot instability across terminal envs  | Snapshots generated under a pinned terminal profile in CI (tmux) |
  | Focus engine complexity creep              | Ship registry + traversal + capture ONLY; no modal system until palette (P5) |
  | Wide-glyph/emoji drift                      | D8 already bans emoji; CI charset check              |
