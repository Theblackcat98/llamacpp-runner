llama-deck: Technical Specification & UI Architecture
Version 2.2 (reconciled against the implementation 2026-09-16) — A declarative Terminal User Interface built with OpenTUI to discover, inspect, configure, and orchestrate llama-server (llama.cpp) instances with persistent profile management.

v1 → v2 REVISION SUMMARY
 * Architecture: core engine split into a headless package (zero UI imports) + OpenTUI shell + CLI frontend.
 * Process safety: dedicated lifecycle section; "pause" removed; Ctrl+C semantics redesigned; orphan detection & crash-safe teardown promoted to Phase 1.
 * VRAM estimator: formula corrected (GQA n_kv_heads, explicit head_dim); presented as a range; compute buffer & overhead added.
 * Flag drift: centralized flag registry with version metadata and runtime --help validation.
 * Widget gap: Phase 2 (widget library) added; OpenTUI provides no batteries-included widgets.
 * Telemetry: --slots / --metrics launch prerequisites documented; Prometheus /metrics parsing specified.
 * Log drawer: \r (carriage-return) line assembler specified; PTY-default with pipe fallback.
 * Storage: atomic writes, schema migrations, lastSession state; JSON confirmed over SQLite.
 * Added: error-state inventory, testing strategy, terminal compat matrix, decision log.
 * Roadmap v2.1: work items resized to branch granularity; §7 error states ship with
   their owning component/phase instead of being deferred wholesale to Phase 5.
 * Consistency: all paths standardized to ~/.config/llama-deck/ and $XDG_STATE_HOME/llama-deck/.

 v2.2 RECONCILIATION (2026-09-16) — spec aligned with recorded decisions and shipped behavior:
  * D3 (PTY) UNDER REVISION: the implementation transports logs over pipes; the Phase-1
    "D3 pivot" (prd-phase-1 §11) was never recorded. Ratify pipes (#68 delivers the live
    \r in-place progress) or schedule PTY work — tracked in #63. Body text below describes
    the current pipe transport.
  * Orphan "adopt" retired in v1 (D11); kill with 2-press confirmation is the only recovery.
  * Components Catalog excluded from the product shell; retained as an internal regression
    artifact (D12).
  * Theme set is 7 — Matrix dropped, Rose Pine / Nord / Everforest added (D13).
  * GGUF reader caps: 256 KB → 2 MB → 32 MB retry ladder (§3.1).
  * CLI surface grown (quick, presets, import, doctor, export --format json); keybinding
    table (§4) matches shipped bindings.
  * Storage: config.json + presets.json split documented (§5); ownership consolidation
    tracked in #69.
  * Open requirements reference their issue number so "requirement" vs "status" is
    unambiguous.

1. System Architecture

 1.1 Layered Architecture (Headless Core)

 The single most important structural rule: THE CORE ENGINE HAS ZERO UI IMPORTS. All domain
 logic (parsing, scanning, estimation, process supervision, telemetry, persistence) lives in
 a headless package that communicates exclusively through a typed event bus. The OpenTUI
 layer renders state and dispatches intents. A CLI frontend reuses the same core.

 ┌────────────────────────────────────────────────────────────────────────┐
 │                      PRESENTATION LAYER (src/ui)                       │
 │   OpenTUI (@opentui/react) + llama-deck widget library                 │
 │   Screens: [1] Explorer  [2] Configurator  [3] Telemetry  [4] Presets  │
 │   Shell: tab manager · focus engine · command palette · log drawer     │
 └───────────────────────────────┬────────────────────────────────────────┘
                                 │  intents ↓   /   state ↑  (typed event bus)
 ┌───────────────────────────────▼────────────────────────────────────────┐
 │                CORE APPLICATION ENGINE (src/core — headless)           │
 │  ┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐     │
 │  │ GGUF Parser       │ │ Model Scanner     │ │ Flag Registry     │     │
 │  │ - Magic/version   │ │ - Recursive scan  │ │ - id → CLI/type   │     │
 │  │ - KV unpacker     │ │ - Split-file grp  │ │ - since/deprecated│     │
 │  │ - Tensor infos    │ │ - mtime cache     │ │ - cmd builder     │     │
 │  │ - Exact params    │ │ - fs watcher      │ │ - sh/systemd expr │     │
 │  └───────────────────┘ └───────────────────┘ └───────────────────┘     │
 │  ┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐     │
 │  │ VRAM Estimator    │ │ Process Supervisor│ │ Telemetry Poller  │     │
  │  │ - GQA-aware KV    │ │ - pipe spawn      │ │ - /health states  │     │
 │  │ - Range output    │ │ - \r assembler    │ │ - /slots JSON     │     │
 │  │ - Compute buffer  │ │ - Ring buffer     │ │ - /metrics parse  │     │
 │  └───────────────────┘ └───────────────────┘ └───────────────────┘     │
 │  ┌───────────────────┐                                                 │
 │  │ Preset Store      │  (atomic JSON, versioned migrations)            │
 │  └───────────────────┘                                                 │
 └───────────────────────────────┬────────────────────────────────────────┘
                                 │
                   ┌──────────────┴──────────────┐
                    │  CLI FRONTEND (src/cli.ts) │
                    │  llama-deck start <preset> │
                    │  llama-deck export <p>     │
                    │    --format sh|systemd|    │
                    │    cmd|json · import       │
                    │  llama-deck scan|list|kill │
                    │  llama-deck quick|presets  │
                    │  llama-deck doctor         │
                    └─────────────────────────────┘

 Rationale
  * Testability: parser, estimator, registry, and supervisor are unit/integration-testable
    without spawning a TUI.
  * Free CLI: `start`/`export` fall out of the headless core almost for free — instantly
    scriptable (systemd timers, shell aliases) and CI-testable.
  * Framework risk containment: if OpenTUI's alpha status bites, the UI shell can be swapped
    (Ink, Solid bindings) without touching domain logic.

 1.2 Component Breakdown

  * UI Engine (@opentui/core & @opentui/react): Renders flexbox-based layouts, manages ANSI
    themes, handles terminal resize events, and diffs frame updates with minimal redraw
    overhead. NOTE: OpenTUI ships primitives only (box, text, layout, input events, frame
    diffing). Tables, sliders, text inputs with cursor management, scrollable/virtualized
    regions, and cross-pane focus management are ALL custom — see Phase 2 (Widget Library).

   * GGUF Metadata Parser: Streams the first <=256 KB of .gguf files (no mmap, no weight
     reads), retrying at 2 MB and 32 MB caps when the header spans them. Validates magic +
     version, unpacks metadata KV pairs and tensor infos. See §3.1.

  * Model Scanner & Watcher: Recursive scan of configured directories; groups multi-part
    split files (`*-00001-of-0000N.gguf`); caches parsed metadata keyed by
    (path, size, mtime) to avoid re-parsing; incremental fs-watch events.

  * Flag Registry & Command Builder: Single source of truth for every supported
    llama-server flag: CLI names, type, range, default, ui widget binding, introduction
    version, and deprecation status. Drives the configurator form, the live command
    preview, and all exporters. Optionally validated against the user's actual binary by
    parsing `llama-server --help` at runtime. See §3.3.

   * Process Supervisor: Spawns llama-server over plain pipes (detached: false; shared
     process group). Assembles \r-overwritten lines before buffering into an in-memory
     ring buffer; ANSI SGR sequences in log lines are parsed and re-rendered thematically.
     Enforces teardown guarantees (§6). Monitors health via GET /health. [D3 revision
     pending — PTY was the v2 default but never shipped; see Decision Log and #63.]

  * Telemetry Poller: Polls /health (2 s) and /slots (5 s); scrapes /metrics (Prometheus
    text format) for tokens/sec and KV cache utilization. Requires --slots and --metrics
    to be baked into the launch command when telemetry is enabled (§3.5).

   * Configuration & Preset Store: JSON at ~/.config/llama-deck/ — presets.json (presets,
     lastSession, binary_path, legacy theme / default_model_dir) plus config.json (models
     dir, theme, cached hardware probe) — with atomic writes (write temp + rename) and
     forward migrations keyed by schema version (§5). Ownership consolidation tracked
     in #69.

 1.3 Runtime Requirements

  * Bun is the required runtime (OpenTUI's TypeScript bindings reach the Zig core via FFI;
    Node.js is not assumed). Pin a Bun version in package.json ("packageManager") and CI.
   * No native dependencies on the spawn path (pipes only — see the D3 revision).
     Clipboard: OSC 52 primary (works over SSH), fallback to xclip/xsel/wl-copy/pbcopy.

2. UI Layout & Viewport Specifications

 The interface conforms to the visual structure of the OpenTUI design system (see
 opentui.html — the design lab mockup is the STYLE GUIDE of record for palettes, box-title
 conventions, log tags, status badges, and footer hints). It is NOT a layout contract:
 CSS-only artifacts (border-radius, responsive auto-fit grids, hover states, scrollbars,
 native select dropdowns) do not translate to terminals and must not be treated as
 requirements.

 ┌────────────────────────────────────────────────────────────────────────┐
 │ [●][●][●] llama-deck v2.0.0 — llamacpp Manager        THEME: [TokyoNight]│
 ├────────────────────────────────────────────────────────────────────────┤
 │ [1] Model Explorer  │ [2] Launch Config │ [3] Server Telemetry │ [4] Presets │
 ├────────────────────────────────────────────────────────────────────────┤
 │ ┌─ MODELS (Directory: ~/models/llm) ────┐ ┌─ METADATA INSPECTOR ─────┐ │
 │ │  NAME             SIZE    QUANT   ARCH│ │ File: Qwen2.5-Coder-32B   │ │
 │ │> qwen2.5-coder... 19.8GB  Q4_K_M  qwen│ │ Arch: qwen2               │ │
 │ │  llama-3.1-8b...  4.9GB   Q4_K_M  llam│ │ Context Max: 32,768      │ │
 │ │  mistral-nemo...  7.1GB   Q5_K_M  llam│ │ Params (exact): 32.76B    │ │
 │ │  deepseek-r1-...  8.4GB   Q4_K_M  qwen│ │ Quant: Q4_K_M (~4.8 bpw)  │ │
 │ │                                       │ │ Est. VRAM: 21.1 – 23.8 GB │ │
 │ └───────────────────────────────────────┘ └──────────────────────────┘ │
 │ ┌─ QUICK LAUNCH COMMAND PREVIEW ─────────────────────────────────────┐ │
 │ │ llama-server -m ~/models/llm/qwen2.5-coder-32B.gguf -c 32768 -ngl 64 │
 │ └────────────────────────────────────────────────────────────────────┘ │
 ├────────────────────────────────────────────────────────────────────────┤
 │ ┌─ SYSTEM LOGS (stdout) ───────────────────────────── [Clear Log] ───┐│
 │ │ [20:30:12] [SRV] llama_model_loader: loaded meta data with 33 keys   ││
 │ │ [20:30:14] [SRV] llm_load_tensors: offloading 64 repeating layers... ││
 │ │ [20:30:15] [HTTP] HTTP server listening on http://127.0.0.1:8080    ││
 │ └──────────────────────────────────────────────────────────────────────┘│
 ├────────────────────────────────────────────────────────────────────────┤
 │ [Tab] Cycle Focus | [Enter] Launch | [Ctrl+P] Palette | [x] Kill | [q] Quit │
 └────────────────────────────────────────────────────────────────────────┘

 2.1 Layout & Responsiveness Rules (terminal reality)

  * Minimum supported viewport: 100 columns x 30 rows. Below this, render a degraded
    single-column layout with a "resize to continue" hint; never render overlapping boxes.
  * Split panes use FIXED flex ratios (Explorer 60/40), not responsive grids. Pane
    visibility (not ratio) may change at >=140 columns (e.g., show metadata + params panes).
  * Spinners are braille / quadrant-block / ASCII only (⠋⠙⠹, ▛▜▟▙, | / - \). Emoji glyphs
    (e.g., clock faces) rely on wide-glyph support that varies by emulator — prohibited.
   * Themes (7): Tokyo Night (default), Catppuccin, Gruvbox, Cyberpunk, Rose Pine, Nord,
     Everforest. The first four lift tokens verbatim from the CSS variables in
     opentui.html; Rose Pine / Nord / Everforest were added beyond the mockup, and the
     mockup's Matrix theme was dropped (D13).

 2.2 Viewport 1: Model Explorer (Split View)
  * Left Pane: focusable virtualized data table (filename, size, quant tag, architecture).
    Virtualization is mandatory: model directories routinely hold 100+ files.
  * Right Pane: GGUF header details, exact parameter count, effective bpw, and estimated
    VRAM range (see §3.2).
   * Bottom Pane: one-line preview strip of the launch target. NOTE: the Explorer today
     renders only `llama-server -m <path>` (not the full generated command); aligning it
     with the Configurator preview or relabeling it is tracked in #67.

 2.3 Viewport 2: Launch Configurator (Form Controls) — mockup: opentui.html tab [5]
  * GPU Offload: slider (0 .. block_count+1 read from GGUF metadata).
   * Context Length: preset chips (4096 … 131072), clamped to the model's
     {arch}.context_length with a warning when exceeding it.
   * Network: text inputs --host (default 127.0.0.1; a 0.0.0.0/:: bind holds the launch
     until a second Ctrl+Y confirms), --port (default 8080; pre-flight bind check before
     launch).
  * Toggles: --flash-attn, --mlock, --no-mmap, --slots, --metrics (telemetry pair,
    default ON).
  * KV cache precision: K/V selectors (f16, q8_0, q4_0) with live KV-size impact shown.
   * Actions: [Enter] Launch · [Ctrl+S] Save Preset · [Esc] Reset Defaults.

 2.4 Viewport 3: Server Telemetry — mockup: opentui.html tab [6]
  * Status header: state badge (STARTING / LOADING / READY / FAILED), model, uptime,
    endpoint URL.
  * Meters: VRAM estimate vs. actual (when /metrics reports), KV cache usage ratio,
    prompt/decode tokens-per-second with ASCII sparkline history (▁▂▃▅▇).
   * Slots table: id, state, prompt tokens, decoded tokens, generating flag (needs --slots).

 2.5 Persistent Console Drawer
  * Collapsible 6-line ANSI terminal. Color-coded tags: [SYS] [SRV] [HTTP] [ERR].
   * Input path: pipes → \r line assembler → ring buffer (bounded, e.g. 10k lines; ANSI
     SGR preserved) → rendered viewport. Carriage-return progress lines must update IN
     PLACE, they do not append (llama.cpp model-loading progress otherwise becomes
     hundreds of lines). [The assembler collapses \r today; live in-place rendering of
     the in-progress line is open work — #68. PTY transport: see the D3 revision.]
  * Live autoscroll; pauses on user scroll-up; resumes via [G]/[End]. Autoscroll behavior
    is tested together with focus changes (known subtle interaction).

 2.6 Command Palette Overlay (Ctrl+P)
   * Modal fuzzy-search across the action registry: switch theme (×7), set port, kill
     server, export/yank command, rescan models, toggle telemetry, auto-fit ngl, go to
     tab 1–4, clear log. (Adopt-orphan retired — D11.)

3. Feature Matrix

 3.1 GGUF Parsing (header-only, streaming)

  Header layout (v3):
   ┌──────────────┬─────────┐
   │ magic        │ 4 B     │ "GGUF"
   │ version      │ u32     │ v1/v2/v3 (v2+ uses u64 lengths/counts)
   │ tensor_count │ u64     │
   │ kv_count     │ u64     │
   │ kv_pairs     │ kv_count│ key(string) type(u32) value
   │ tensor_infos │ n       │ name(string) n_dims(u32) dims(u64[n]) type(u32) offset(u64)
   └──────────────┴─────────┘
  Value types: 0..7 scalars (u8..f32, bool), 8 string, 9 array, 10..12 (u64, i64, f64).

  * Metadata extracted: general.architecture, general.file_type (quant enum → human name
    via quant-map table), {arch}.context_length, {arch}.block_count,
    {arch}.embedding_length, {arch}.attention.head_count, {arch}.attention.head_count_kv,
    {arch}.attention.key_length (explicit head dim, e.g. Gemma), {arch}.vocab_size.
  * EXACT parameter count: sum of product(dims) across all tensor_infos (all present in
    the header; weights never read).
  * Effective bpw: (total_file_size x 8) / total_params — computed, not hard-coded.
  * Multi-part models: scanner groups `name-00001-of-00003.gguf` siblings; metadata from
    part 1; size = sum of parts.
  * Corrupt/unknown files (bad magic, truncated header, unsupported version) are flagged
    in the table with a parse-error glyph, never crash the scanner.
   * Reader caps streaming at 256 KB, retrying at 2 MB and finally 32 MB if kv/table
     spans the cap; hostile headers (count/length overflows) are rejected, never crash
     the scanner.

 3.2 VRAM Estimator (GQA-aware, range output)

  CORRECTED FORMULA (v1 incorrectly used n_heads; GQA models would overestimate 8x):
    kv_bytes = 2 x n_layers x n_ctx x n_kv_heads x head_dim x bytes_per_elem
               (K and V are sized independently when cache_type_k ≠ cache_type_v)
   head_dim = ({arch}.attention.key_length) ?: embedding_length / head_count
   bytes_per_elem: f16 = 2.0 · q8_0 ≈ 1.0 · q4_0 ≈ 0.5625

  Total presented as a RANGE:
   low  ≈ offloaded_weights + kv_bytes + compute_min  + overhead (300 MB)
   high ≈ offloaded_weights + kv_bytes + compute_max  + overhead (800 MB)
   offloaded_weights ≈ file_size x (ngl / (block_count + 1))   [output layer = the +1]
   compute buffer: 0.5–2 GB, scaling with ctx and batch size.

  The estimator is a PURE function (metadata + flags → range), table-driven tested against
  known real-world configurations. UI always labels output "estimated range".

 3.3 Flag Registry & Exporters

  {
    "id": "n_gpu_layers", "cli": ["-ngl", "--n-gpu-layers"], "type": "int",
    "min": 0, "max": "meta:block_count+1", "default": null,
    "since": "b4000", "deprecated": false,
    "ui": { "widget": "slider", "label": "GPU Offload" }
  }

  * All flags flow through the registry (form widgets, command preview, exporters).
   * Runtime validation: parse `llama-server --help` output; flags absent from the user's
     binary are dropped from the built argv and must surface as disabled/marked fields in
     the UI, with deprecated flags rendering warnings (UI surfacing open: #65;
     `llama-deck doctor` warns today).
   * Exporters: (a) clipboard via OSC 52 with xclip/wl-copy/pbcopy fallback; (b) .sh script
     with env vars and exec; (c) systemd unit (Type=simple, Restart=on-failure, ExecStart);
     (d) portable single-preset JSON (`export --format json` / `import`).

 3.4 Server Runtime & Execution
   * Start / stop (restart = stop + relaunch). NO PAUSE — llama-server has no pause semantics; SIGSTOP
    freezes the process while holding all VRAM. Removed as a footgun (v1 listed it).
  * v1 manages EXACTLY ONE instance (port-conflict pre-flight check before spawn).
    Preset schema leaves room for future multi-instance.
  * Changing ctx-size / model / ngl requires restart (server reloads weights); the
    configurator marks such edits "restart required" rather than implying hot-swap.

 3.5 Telemetry
  * /health: 200 → READY · 503 → LOADING. Combined with log markers, drives the state
    machine: STARTING → LOADING → READY | FAILED (exit code + error log pattern).
  * /slots (5 s poll) requires --slots; /metrics scrape requires --metrics. Both flags are
    auto-injected into the launch command when telemetry is enabled (default ON).
  * tokens/sec parsed from /metrics (Prometheus text: llamacpp:* series) — NOT regexed
    from log lines.

4. Keyboard Navigation & Keybinding Specification

 | Keybinding      | Scope            | Action                                              |
 |-----------------|------------------|-----------------------------------------------------|
 | Tab / Shift+Tab | Global           | Cycle focus forward / backward (screen ↔ console)   |
 | 1 – 4           | Global (normal)  | Switch to tab [1]–[4]                               |
 | ?               | Global           | Toggle keybinding legend overlay                    |
 | Ctrl+P          | Global           | Command palette modal                               |
 | Ctrl+L          | Global           | Clear log window                                    |
 | q / Ctrl+C      | Global           | Quit app AND tear down child (confirm if running;   |
 |                 |                  | second press within 2 s force-quits)                |
 | x               | Global (normal)  | KILL running server (explicit, with confirmation)   |
 | k               | Global (normal)  | Kill ORPHANED server (2-press arm; ownership vs     |
 |                 |                  | table `k` under revision — #55)                     |
 | o               | Global           | Collapse / expand console drawer                    |
 | Enter           | Global (normal)  | Launch; on Presets: set default preset. Yields to   |
 |                 |                  | the Explorer dir editor while it is open            |
 | j / k, ↑ / ↓    | Table / List     | Navigate rows                                       |
 | g / G, Home/End | Table / Console  | Jump top / bottom (console: also resumes autoscroll)|
 | Space           | Checkbox         | Toggle setting                                      |
 | m               | Explorer         | Set models directory                                |
 | r               | Explorer         | Rescan models directory                             |
 | a               | Configurator     | Auto-fit GPU offload (-ngl) to VRAM                 |
 | Ctrl+S          | Configurator     | Save current configuration as a preset              |
 | y               | Configurator     | Yank generated command to clipboard                 |
 | Ctrl+Y          | Global           | Confirm host-exposing (0.0.0.0/::) launch           |
 | Esc             | Modal / editor   | Close overlay; cancel dir editor; reset the         |
 |                 |                  | Configurator to defaults                            |
 | i               | Config/Presets   | Import shell command / preset document              |
 | t               | Telemetry        | Toggle telemetry on / off                           |
 | c / d / l / r   | Presets          | Clone / delete (2-press) / load+go / relink         |

 Rationale: terminal muscle memory says Ctrl+C = quit. It must NEVER quit the app while
 leaving an orphaned llama-server holding VRAM. Killing the server is a separate, explicit
 action (x / palette). Text inputs capture printable keys; global bindings apply in
 normal mode only (one owner per key — see #55 for the known `k` exception).

5. Storage Schema & Configuration Layout

  Configuration: $XDG_CONFIG_HOME/llama-deck/ (default ~/.config/llama-deck/).
  Runtime state:  $XDG_STATE_HOME/llama-deck/  (default ~/.local/state/llama-deck/) —
                  server.pid, models metadata cache, calibration history. State never
                  lives in the config dir.

  App-level settings live in config.json (modelsDir, theme, cached hardware probe);
  presets.json carries the preset store plus lastSession and binary_path. Consolidating
  ownership (single home for binary path / theme, dropping dead fields, standard
  ~/.config precedence) is tracked in #69.

  presets.json (schema version 2):
  {
    "$schema": "./schema.preset.json",
    "version": 2,
    "default_model_dir": "~/models/llm",
    "theme": "tokyonight",
    "binary_path": "/usr/local/bin/llama-server",
    "lastSession": { "preset_id": "qwen-32b-coding", "tab": 1 },
    "presets": [
      {
        "id": "qwen-32b-coding",
        "name": "Qwen 2.5 Coder 32B (Full Offload)",
        "model_path": "~/models/llm/qwen2.5-coder-32b-instruct-q4_k_m.gguf",
        "flags": {
          "n_gpu_layers": 65, "ctx_size": 32768, "batch_size": 2048,
          "ubatch_size": 512, "threads": 8, "flash_attn": true,
          "cache_type_k": "q8_0", "cache_type_v": "q8_0",
          "host": "127.0.0.1", "port": 8080, "slots": true, "metrics": true,
          "alias": "qwen2.5-coder"
        },
        "env_vars": { "CUDA_VISIBLE_DEVICES": "0" },
        "created_at": "2026-08-23T10:00:00Z",
        "last_used": null
      }
    ]
  }

  * Persistence rules: atomic writes (temp file + rename, same dir); forward-only
    migrations (version field); backups presets.json.bak on migration; unknown flags in a
    preset are preserved verbatim (round-trip safe) and flagged in the UI.
   * JSON over SQLite (decision D1): hand-editable, diff-friendly, no native deps.
   * presets.json `theme` / `default_model_dir` are legacy inputs: theme falls back to
     config.json's persisted theme; default_model_dir only seeds a first-run models dir.
     Effective ownership moves to config.json per #69.

6. Process Lifecycle & Safety

 6.1 Spawn
   * Pipes (D3 revision pending — PTY never shipped; see the Decision Log and #63).
     detached: false; child shares the app's process group so group signals cannot
     orphan it.
  * Launch command is built by the flag registry; env vars applied from preset.

 6.2 Teardown guarantees (implemented in Phase 1, not later)
  * Kill path: SIGINT → wait ≤5 s for exit → SIGKILL.
  * Exit hooks registered at startup: SIGINT, SIGTERM, SIGHUP, uncaughtException,
    unhandledRejection, beforeExit. Every hook runs the same idempotent teardown.
  * In-flight spawn guard: if teardown begins while the child is starting, kill waits for
    the process handle before signaling (no spawn/kill race).

 6.3 Orphan detection & recovery
  * Supervisor writes $XDG_STATE_HOME/llama-deck/server.pid: { pid, port, preset_id,
    started_at }.
   * On startup, if a pidfile exists: verify /proc/<pid> is alive AND its cmdline contains
     llama-server; probe the recorded port. Offer kill (2-press confirmation) — adopt was
     retired in v1 (D11); kill is the only recovery path. Stale pidfiles are cleaned
     silently. Platforms without /proc report "identity unavailable" rather than guessing.

 6.4 Failure handling
  * Non-zero exit → FAILED state with the last 50 log lines surfaced; known patterns
    (CUDA OOM, port bind failure, missing model file) matched and presented with a
    suggested fix (lower -ngl / -c, free the port, re-scan models).

7. Error & Edge State Inventory

 | State                        | Detection                    | Handling                               |
 |------------------------------|------------------------------|----------------------------------------|
 | Port in use                  | Pre-flight bind check        | Error + suggest next free port         |
 | VRAM OOM at load             | Exit code + log pattern      | FAILED + suggest lower ngl/ctx/kv quant|
 | Model file missing/changed   | Scanner/watcher              | Preset marked broken; re-link prompt  |
 | Corrupt GGUF (bad magic)     | Parser                       | Flagged row in table; never crashes    |
 | Multi-part GGUF              | Filename pattern             | Grouped; summed size; metadata part 1  |
 | First run, no models dir     | Startup                      | Onboarding prompt to set directory     |
  | llama-server not on PATH     | Startup `which`/probe | Boot warning + FAILED binary_not_found (no spawn); binary_path settable via `llama-deck config` (open: #69) |
  | Binary too old for a flag    | --help parse vs registry | Flag dropped from argv + UI marker / doctor warning (open: #65) |
 | Terminal below 100x30        | Resize event                 | Degraded single-column + resize hint   |
 | TUI crash mid-session        | Exit hooks                   | Teardown runs; pidfile enables recovery|
 | Split-file sibling deleted   | Scanner                      | Group marked incomplete                |

8. Testing Strategy

  * Unit (core, no TUI):
     - GGUF parser: committed binary fixtures = first 64 KB of REAL .gguf headers
       (llama3 incl. yarn rope-scaling, qwen2, qwen3moe, gemma, phi3, command-r,
       deepseek2) + generated edge cases (v1/v2 headers, string arrays, truncated
       stream, split files, property fuzz).
    - VRAM estimator: table-driven against known real-world configs; GQA vs MHA cases;
      property test — output is a valid range and monotonic in ctx and ngl.
    - Flag registry / command builder: golden command strings; deprecated/absent flag
      filtering; exporter output (sh, systemd) golden files.
    - Preset store: migrations v1→v2, atomic-write failure injection, round-trip of
      unknown flags.
  * Integration:
     - Supervisor vs a fake-server.sh fixture: emits \r progress lines, ANSI colors,
       delayed /health 503→200, configurable exit codes. Asserts: line assembly, state
       machine transitions, teardown within timeout, pidfile lifecycle, orphan kill.
    - Telemetry poller vs a mock HTTP server (canned /slots, /metrics payloads).
   * UI:
     - Golden frame + span snapshots per screen and theme; focus-order traversal tests;
       palette filtering; autoscroll-pause interaction tests; table-driven pure
       shell-key-router tests (contexts × keys).
   * Composition-root E2E (real SessionApp wiring, keys pressed through the harness —
     #31) and tmux black-box smoke flows (boot, mixed-case input, viewport matrix — #54).
     Release-gate suites live in tests/automated-manual/.
  * Compat matrix (manual checklist per release, automated where feasible): tmux, kitty,
    ghostty, wezterm, alacritty, VSCode integrated terminal — braille width, box glyphs,
    OSC 52, truecolor.

9. Implementation Milestones

  Every phase ends with an explicit EXIT CRITERION. The walking skeleton lands in Phase 1:
  end-to-end truth in week one beats four perfect phases meeting for the first time in
  month two. Each bullet below is a branch-sized WORK ITEM — one branch, one mergeable
  deliverable. The full branch/commit/merge/verify loop is specified in AGENTS.md.

  STATUS (2026-09-16): Phases 1–5 are complete (boundary tag v0.5.0); the roadmap below is
  historical record and new work is issue-driven. Post-audit remediation Phases 6–14 are
  recorded in plans/audit-remediation-roadmap.md with the manual-evidence ledger in
  plans/manual-verification-checklist.md. The 2026-09-16 audit follow-ups are issues
  #55–#71 (plans/audit-2026-09-16-remediation-plan.md). Revisions discovered after the
  phases closed: Phase 1's PTY spike resulted in the pipe transport (D3 revision pending);
  Phase 2's Components Catalog was later excluded from the product shell (D12); the theme
  set grew from 5 to 7 (D13).

 ┌──────────────────────────────────────────────────────────────────────────┐
 │ DEVELOPMENT ROADMAP v2.1                                                 │
 ├──────────────────────────────────────────────────────────────────────────┤
 │ Phase 1: Walking Skeleton + Safety Net                                   │
 │ ├─ Scaffold: pin Bun, @opentui/react shell, CI pipeline;                 │
 │    import-lint guard: src/core imports nothing from src/ui (D5)          │
 │ ├─ Spikes (timeboxed, throwaway): node-pty under Bun; OpenTUI render     │
 │    smoke test                                                            │
 │ ├─ Typed event bus (headless)                                            │
 │ ├─ \r line assembler + bounded ring buffer (pure)                        │
 │ ├─ Supervisor: PTY spawn vs fake-server.sh fixture; teardown hooks       │
 │    (§6.2) + port pre-flight + PATH check live here                       │
 │ ├─ Pidfile + orphan detection & recovery (§6.3)                          │
 │ ├─ Minimal shell: tabs + status bar                                      │
 │ ├─ Console drawer (\r-aware autoscroll)                                  │
 │ ├─ Spawn HARDCODED model end-to-end; logs render in drawer               │
 │ └─ EXIT: launch → watch logs → quit → zero orphaned processes            │
 ├──────────────────────────────────────────────────────────────────────────┤
 │ Phase 2: Widget Library (the hidden 60% of the project)                  │
 │ ONE BRANCH PER WIDGET; golden frame test ships with each widget:         │
 │ ├─ Slider · checkbox · text input (cursor mgmt) · cycling select         │
 │ ├─ Virtualized data table · scrollable pane                              │
 │ ├─ Cross-pane focus engine LAST (every widget depends on it)             │
 │ ├─ Theme provider: 5 themes, tokens lifted from opentui.html             │
 │ ├─ Degraded <100x30 layout + resize hint ships here (§7)                 │
 │ └─ EXIT: mockup "Components Catalog" tab reproduced pixel-for-pixel      │
 ├──────────────────────────────────────────────────────────────────────────┤
 │ Phase 3: GGUF Parsing & Model Discovery                                  │
 │ ├─ Streaming parser + committed fixtures; exact param count;             │
 │    effective bpw; corrupt-file flagging ships here (§7)                  │
 │ ├─ Scanner: recursive walk, split-file grouping (+ incomplete-group      │
 │    state), mtime cache, incremental fs watcher (§7)                      │
 │ ├─ VRAM estimator (pure fn) + GQA/MHA table tests (§3.2)                 │
 │ ├─ Explorer screen wired to real data; first-run dir onboarding          │
 │ ├─ CLI falls out free: llama-deck scan | list                            │
 │ └─ EXIT: 100-file directory parses <2 s warm; corrupt files flagged      │
 ├──────────────────────────────────────────────────────────────────────────┤
 │ Phase 4: Configurator, Registry & Persistence                            │
 │ ├─ Flag registry + command builder (golden command strings)              │
 │ ├─ Exporters: .sh + systemd golden files; OSC 52 clipboard as its        │
 │    own branch (environment-dependent)                                    │
 │ ├─ Preset store: atomic writes, forward migrations, unknown-flag         │
 │    round-trip (§5)                                                       │
 │ ├─ Configurator screen wired to registry; restart-required marks         │
 │ ├─ Runtime --help validation ("binary too old" state ships here §7)      │
 │ ├─ CLI gains: llama-deck start | export                                  │
 │ └─ EXIT: build, save, launch, export a preset; restart-required marks    │
 ├──────────────────────────────────────────────────────────────────────────┤
 │ Phase 5: Telemetry, Errors & Polish                                      │
 │ ├─ /health state machine (STARTING → LOADING → READY|FAILED)             │
 │ ├─ /slots + /metrics scraping vs mock HTTP; Server screen (§3.5)         │
 │ ├─ Failure diagnosis: OOM / bind-fail log patterns + fixes (§6.4)        │
 │ ├─ Command palette complete; yank-to-clipboard (y)                       │
 │ ├─ CLI gains: llama-deck kill                                            │
 │ ├─ §7 audit: every error row verified green at its owner component       │
 │ ├─ Terminal compat matrix pass (tmux/kitty/ghostty/wezterm/etc)          │
 │ └─ EXIT: full error table green; compat checklist signed off             │
 └──────────────────────────────────────────────────────────────────────────┘

10. Decision Log

  | #  | Decision                                  | Rationale                                        |
  |----|-------------------------------------------|--------------------------------------------------|
  | D1 | JSON presets, not SQLite                  | Hand-editable, diff-friendly, no native deps     |
  | D2 | Bun runtime, pinned                       | OpenTUI TS bindings reach Zig via FFI            |
  | D3 | ⚠ UNDER REVISION: pipes shipped; PTY never implemented. Ratify pipes (#63; live \r progress via #68) or schedule PTY work | Pipes: no native deps, \r via assembler; PTY: color fidelity |
  | D4 | Single managed instance (v1)              | Scope control; schema ready for multi later      |
  | D5 | Headless core + UI shell + CLI            | Testability, free CLI, framework risk insurance  |
  | D6 | OSC 52 clipboard primary                  | Works over SSH; local tool fallbacks             |
  | D7 | No "pause" feature                        | SIGSTOP holds VRAM hostage; footgun removed      |
  | D8 | Braille/ASCII spinners only               | Emoji width varies by terminal emulator          |
  | D9 | Flag registry + --help runtime validation | llama-server flags drift across releases         |
  | D10| mockup = style guide, not layout contract | CSS artifacts (radius, grids, hover) don't map   |
  | D11| Orphan adopt retired (v1); kill with 2-press confirm is the only recovery | Recorded 2026-09-14, commit 8dd2fb2 (audit F8) |
  | D12| Components Catalog = internal regression artifact, not a product tab | Recorded 2026-09-14, commit 410cb93 (audit F5) |
  | D13| Theme set = 7 (Matrix dropped; Rose Pine / Nord / Everforest added) | Pinned by README + docs-consistency test (#20/#21) |
