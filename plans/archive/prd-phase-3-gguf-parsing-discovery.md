> Archive note (2026-09-11): automated acceptance green; manual checks tracked in plans/manual-verification-checklist.md — tick boxes there, not here.

PRD — Phase 3: GGUF Parsing & Model Discovery
llama-deck · Document: plans/archive/prd-phase-3-gguf-parsing-discovery.md · Spec ref: llamamanager.md §9 Phase 3

 1. Summary

 Implement the domain heart of the Explorer screen: a streaming, header-only GGUF parser;
 a recursive model scanner with split-file grouping, mtime-keyed caching, and fs watching;
 the GQA-aware VRAM estimator; and the Explorer UI wired to real data. Nothing in this
 phase touches process management beyond reusing Phase 1's supervisor.

 2. Goals

  * Parse GGUF v1/v2/v3 headers (metadata KV + tensor infos) from a <=256 KB stream.
  * Exact parameter counts and computed effective bpw.
  * Scanner: fast warm scans over 100+ files, live updates on file changes.
  * VRAM estimator as a pure, table-tested function producing a RANGE.
  * Explorer screen (table + inspector + command preview strip) showing real data.

 3. Non-Goals

  * No launching from the Explorer yet (quick-launch lands with Phase 4's command builder;
    this phase shows the model path placeholder in the preview strip).
  * No preset linkage, no configurator.
  * No model downloads or HF integration.

 4. User Stories

  * As a user, I point llama-deck at ~/models/llm and within seconds see every .gguf with
    size, quant, and arch — including multi-part models shown as ONE row.
  * As a user, I select a model and see its true context limit, exact parameter count,
    quant name, and an estimated VRAM range for a default config.
  * As a user, when I add/remove/rename a .gguf in a watched directory, the table updates
    without a manual rescan.
  * As a user, a corrupt or truncated .gguf shows a warning glyph row; nothing crashes.

 5. Functional Requirements

  | ID       | Requirement                                                             | Spec    |
  |----------|-------------------------------------------------------------------------|---------|
  | P3-FR-01 | Parser validates magic "GGUF" + version ∈ {1,2,3}; unsupported/truncated → typed ParseError, never a crash | §3.1 |
  | P3-FR-02 | Parser reads v2/v3 u64 lengths and counts correctly (v1 u32 path included) | §3.1 |
  | P3-FR-03 | Full KV value-type support: scalars 0..7, string (8), array (9) incl. string arrays, u64/i64/f64 (10..12) | §3.1 |
  | P3-FR-04 | Extracted metadata: general.architecture, general.file_type (→ human quant name via quant-map table), {arch}.context_length, {arch}.block_count, {arch}.embedding_length, {arch}.attention.head_count, {arch}.attention.head_count_kv, {arch}.attention.key_length (when present), {arch}.vocab_size | §3.1 |
  | P3-FR-05 | Exact parameter count = Σ product(dims) over tensor_infos; displayed (e.g., 32.76B) | §3.1 |
  | P3-FR-06 | Effective bpw = (file_size × 8) / total_params, computed and displayed | §3.1 |
  | P3-FR-07 | Streaming cap 256 KB; if header spans the cap, one retry at 2 MB; failure beyond that → ParseError with "header too large" reason | §3.1 |
  | P3-FR-08 | Scanner walks configured directories recursively for *.gguf; non-recursive sibling noise ignored | §3.1 |
  | P3-FR-09 | Split-file grouping: `*-0000N-of-0000M.gguf` siblings collapse to one entry; size = Σ parts; metadata from part 1; deleted sibling → group marked incomplete | §3.1, §7 |
  | P3-FR-10 | Metadata cache keyed by (path, size, mtime); cache persists across sessions in $XDG_STATE_HOME/llama-deck/; warm scan uses cache | §1.2 |
  | P3-FR-11 | fs watcher: create/unlink/rename events trigger incremental re-scan of affected entries (debounced ≥300 ms) | §1.2 |
  | P3-FR-12 | VRAM estimator (pure fn): kv_bytes = 2 × n_layers × n_ctx × n_kv_heads × head_dim × bytes_per_elem; head_dim = key_length ?: embedding_length / head_count; bytes: f16=2.0, q8_0≈1.0, q4_0≈0.5625 | §3.2 |
  | P3-FR-13 | Estimator output is a RANGE: low = weights_offloaded + kv + compute_min + 300 MB; high = same with compute_max + 800 MB; offloaded_weights ≈ file_size × ngl/(block_count+1); compute buffer 0.5–2 GB scaling with ctx/batch | §3.2 |
  | P3-FR-14 | UI labels estimator output "estimated range" — never a bare number | §3.2 |
  | P3-FR-15 | Explorer screen: virtualized table (name, size, quant, arch) + metadata inspector pane (60/40 fixed split) + command preview strip (model path placeholder) | §2.2 |
  | P3-FR-16 | Corrupt/unknown GGUF rows render with parse-error glyph and tooltip/pane reason | §3.1, §7 |
  | P3-FR-17 | First-run with no/unset model directory: onboarding prompt to set one (persisted to config) | §7 |
  | P3-FR-18 | Scanner runs in a worker pool; UI never blocks during parsing | §1.2 |
  | P3-FR-19 | "Rescan Models Directory" action available (palette wiring lands Phase 5; exposed via keybinding r now) | §2.6 |

 6. Non-Functional Requirements

  | ID        | Requirement                                                        |
  |-----------|---------------------------------------------------------------------|
  | P3-NFR-01 | Warm scan of a 100-file directory completes <2 s (cache hit path) — this is the phase exit number |
  | P3-NFR-02 | Cold parse of a single header <50 ms typical (I/O bound)            |
  | P3-NFR-03 | Peak memory during a full scan bounded (<200 MB) — headers only, never weights |
  | P3-NFR-04 | Estimator pure: no I/O, no globals; deterministic for identical inputs |

 7. Deliverables

  * src/core/gguf/: parser.ts, types.ts, quant-map.ts, errors.ts.
  * src/core/models/: scanner.ts, watcher.ts, metadata-cache.ts, split-grouping.ts.
  * src/core/estimate/vram.ts.
  * src/ui/screens/explorer.tsx wired via bus state.
  * tests/fixtures/gguf/: real 64 KB header captures (llama, qwen2, gemma, deepseek2) +
    synthesized edge headers (v1, string arrays, truncated, oversize).
  * tests: parser suite, estimator table suite, scanner integration (tmp dir fixture tree).

 8. Verification & Test Plan

  | Target              | Method                                                                  |
  |---------------------|--------------------------------------------------------------------------|
  | Parser correctness  | Fixture suite per arch; assert every extracted field against known-good values |
  | Parser robustness   | Truncated stream, bad magic, version 4 → typed errors; scanner survives mixed corrupt dir |
  | Param count exact   | Fixture headers: computed params vs published model card numbers          |
  | Split grouping      | tmp-dir integration: 3-part model → 1 row; delete part 3 → incomplete flag |
  | Cache               | Integration: scan → mutate mtime → rescan asserts re-parse only for changed file |
  | Watcher             | Integration: copy/remove fixture .gguf in watched tmp dir; assert incremental events (debounced) |
  | Estimator           | Table-driven real-world configs; GQA vs MHA cases; property: output valid range, monotonic in ctx and ngl |
  | Perf gates          | Automated: 100-file warm scan <2 s (P3-NFR-01); 10k-row table nav budget from P2 |
  | UI                  | Golden frames for explorer populated + corrupt-row states                |

 9. Dependencies & Integration Points

  * Upstream: Phase 1 (bus, state paths), Phase 2 (table/scroll/box/badge widgets).
  * Provides to Phase 4: model registry state (selected model metadata feeds the
    configurator defaults: ngl max = block_count+1, ctx clamp = context_length); estimator
    powers the configurator's live VRAM readout.

 10. Acceptance Criteria (Phase Gate)

  * [ ] All P3-FR-01..19 implemented and verified per §8.
  * [ ] EXIT CRITERION (spec §9): 100-file directory parses <2 s warm; corrupt files
        flagged, scanner survives.
  * [ ] Estimator suite: every table case within tolerance; property tests pass.
  * [ ] Real-model manual pass: 3 personal .gguf files show correct arch/quant/ctx/params.

 11. Risks

  | Risk                                          | Mitigation                                       |
  |-----------------------------------------------|---------------------------------------------------|
  | Fixture drift (new archs, key renames)        | quant-map + key extraction table-driven; new fixtures are one-file additions |
  | FS watcher reliability across platforms       | Debounce + full-rescan fallback action (P3-FR-19) |
  | 2 MB retry still insufficient (huge vocab)    | Rare; surface typed error with actionable message |
  | Estimator credibility (first wrong number burns trust) | Range presentation + conservative overhead; keep test table sourced from real launches |
