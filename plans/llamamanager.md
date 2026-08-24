llama-deck: Technical Specification & UI Architecture
Version 2.0 (post architectural review) — A declarative Terminal User Interface built with OpenTUI to discover, inspect, configure, and orchestrate llama-server (llama.cpp) instances with persistent profile management.

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
 │  │ - GQA-aware KV    │ │ - PTY/pipe spawn  │ │ - /health states  │     │
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
                   │    --format sh|systemd|cmd │
                   │  llama-deck scan|list|kill │
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
    reads). Validates magic + version, unpacks metadata KV pairs and tensor infos. See §3.1.

  * Model Scanner & Watcher: Recursive scan of configured directories; groups multi-part
    split files (`*-00001-of-0000N.gguf`); caches parsed metadata keyed by
    (path, size, mtime) to avoid re-parsing; incremental fs-watch events.

  * Flag Registry & Command Builder: Single source of truth for every supported
    llama-server flag: CLI names, type, range, default, ui widget binding, introduction
    version, and deprecation status. Drives the configurator form, the live command
    preview, and all exporters. Optionally validated against the user's actual binary by
    parsing `llama-server --help` at runtime. See §3.3.

  * Process Supervisor: Spawns llama-server via node-pty (default; preserves ANSI color and
    \r progress bars) with plain pipes as fallback. Assembles \r-overwritten lines before
    buffering into an in-memory ring buffer. Enforces teardown guarantees (§6). Monitors
    health via GET /health.

  * Telemetry Poller: Polls /health (2 s) and /slots (5 s); scrapes /metrics (Prometheus
    text format) for tokens/sec and KV cache utilization. Requires --slots and --metrics
    to be baked into the launch command when telemetry is enabled (§3.5).

  * Configuration & Preset Store: JSON at ~/.config/llama-deck/presets.json with atomic
    writes (write temp + rename) and forward migrations keyed by schema version (§7).

 1.3 Runtime Requirements

  * Bun is the required runtime (OpenTUI's TypeScript bindings reach the Zig core via FFI;
    Node.js is not assumed). Pin a Bun version in package.json ("packageManager") and CI.
  * Native deps (node-pty) must be verified under Bun; pipe fallback exists if PTY is
    unavailable. Clipboard: OSC 52 primary (works over SSH), fallback to xclip/xsel/
    wl-copy/pbcopy.

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
  * Themes (5): Tokyo Night (default), Catppuccin, Gruvbox, Cyberpunk, Matrix — tokens
    lifted verbatim from the CSS variables in opentui.html.

 2.2 Viewport 1: Model Explorer (Split View)
  * Left Pane: focusable virtualized data table (filename, size, quant tag, architecture).
    Virtualization is mandatory: model directories routinely hold 100+ files.
  * Right Pane: GGUF header details, exact parameter count, effective bpw, and estimated
    VRAM range (see §3.2).
  * Bottom Pane: one-line syntax-highlighted preview of the generated shell command.

 2.3 Viewport 2: Launch Configurator (Form Controls) — mockup: opentui.html tab [5]
  * GPU Offload: slider (0 .. block_count+1 read from GGUF metadata).
  * Context Length: number input with preset chips (4096 … 131072), clamped to the model's
    {arch}.context_length with a warning when exceeding it.
  * Network: text inputs --host (default 127.0.0.1; confirm dialog if set to 0.0.0.0),
    --port (default 8080; pre-flight bind check before launch).
  * Toggles: --flash-attn, --mlock, --no-mmap, --slots, --metrics (telemetry pair,
    default ON).
  * KV cache precision: K/V selectors (f16, q8_0, q4_0) with live KV-size impact shown.
  * Actions: [Enter] Save & Launch · [Ctrl+S] Save Preset · [Esc] Reset Defaults.

 2.4 Viewport 3: Server Telemetry — mockup: opentui.html tab [6]
  * Status header: state badge (STARTING / LOADING / READY / FAILED), model, uptime,
    endpoint URL.
  * Meters: VRAM estimate vs. actual (when /metrics reports), KV cache usage ratio,
    prompt/decode tokens-per-second with ASCII sparkline history (▁▂▃▅▇).
  * Slots table: id, state, prompt tokens, generating flag, per-slot t/s (needs --slots).

 2.5 Persistent Console Drawer
  * Collapsible 6-line ANSI terminal. Color-coded tags: [SYS] [SRV] [HTTP] [ERR].
  * Input path: PTY → \r line assembler → ANSI-preserved ring buffer (bounded, e.g. 10k
    lines) → rendered viewport. Carriage-return progress lines update IN PLACE, they do
    not append (llama.cpp model-loading progress otherwise becomes hundreds of lines).
  * Live autoscroll; pauses on user scroll-up; resumes via [G]/[End]. Autoscroll behavior
    is tested together with focus changes (known subtle interaction).

 2.6 Command Palette Overlay (Ctrl+P)
  * Modal fuzzy-search across all actions: switch theme, set port, kill server, export
    command, rescan models, adopt orphaned server (§6.3), toggle telemetry.

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
  * Reader caps streaming at 256 KB (retry once with 2 MB if kv/table spans the cap).

 3.2 VRAM Estimator (GQA-aware, range output)

  CORRECTED FORMULA (v1 incorrectly used n_heads; GQA models would overestimate 8x):
   kv_bytes = 2 x n_layers x n_ctx x n_kv_heads x head_dim x bytes_per_elem
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
    binary are disabled in the UI with a tooltip; deprecated flags render warnings.
  * Exporters: (a) clipboard via OSC 52 with xclip/wl-copy/pbcopy fallback; (b) .sh script
    with env vars and exec; (c) systemd unit (Type=simple, Restart=on-failure, ExecStart).

 3.4 Server Runtime & Execution
  * Start / stop / restart. NO PAUSE — llama-server has no pause semantics; SIGSTOP
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
 | Tab / Shift+Tab | Global           | Cycle focus forward / backward                      |
 | 1 – 4           | Global (normal)  | Switch to tab [1]–[4]                               |
 | Ctrl+P          | Global           | Command palette modal                               |
 | j / k, ↑ / ↓    | Table / List     | Navigate rows                                       |
 | Enter           | Table / Form     | Activate item / submit configuration                |
 | Space           | Checkbox         | Toggle setting                                      |
 | x               | Global (normal)  | KILL running server (explicit, with confirmation)   |
 | Ctrl+C          | Global           | Quit app AND tear down child (confirm if running;   |
 |                 |                  | second press within 2 s force-quits)                |
 | q               | Global (normal)  | Quit (same path as Ctrl+C)                          |
 | Ctrl+L          | Console          | Clear log window                                    |
 | y               | Model View       | Yank generated bash command to clipboard            |

  Rationale: terminal muscle memory says Ctrl+C = quit. It must NEVER quit the app while
  leaving an orphaned llama-server holding VRAM. Killing the server is a separate, explicit
  action (x / palette). Text inputs capture printable keys; global bindings apply in
  normal mode only.

5. Storage Schema & Configuration Layout

  Configuration: $XDG_CONFIG_HOME/llama-deck/ (default ~/.config/llama-deck/).
  Runtime state:  $XDG_STATE_HOME/llama-deck/  (default ~/.local/state/llama-deck/) —
                  server.pid, telemetry cache. State never lives in the config dir.

  presets.json (schema version 2):
  {
    "$schema": "./schema.preset.json",
    "version": 2,
    "default_model_dir": "~/models/llm",
    "theme": "tokyonight",
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

6. Process Lifecycle & Safety

 6.1 Spawn
  * node-pty default (color + \r fidelity), pipe fallback. detached: false; child shares
    the app's process group so group signals cannot orphan it.
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
    llama-server; probe the recorded port. Offer: adopt (attach telemetry + logs tail) or
    kill. Stale pidfiles are cleaned silently.

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
 | llama-server not on PATH     | Startup `which`              | Prompt for binary path; registry idle  |
 | Binary too old for a flag    | --help parse vs registry     | Flag disabled in UI with tooltip       |
 | Terminal below 100x30        | Resize event                 | Degraded single-column + resize hint   |
 | TUI crash mid-session        | Exit hooks                   | Teardown runs; pidfile enables recovery|
 | Split-file sibling deleted   | Scanner                      | Group marked incomplete                |

8. Testing Strategy

  * Unit (core, no TUI):
    - GGUF parser: committed binary fixtures = first 64 KB of REAL .gguf headers
      (one per major arch: llama, qwen2, gemma, deepseek2) + generated edge cases
      (v1/v2 headers, string arrays, truncated stream, split files).
    - VRAM estimator: table-driven against known real-world configs; GQA vs MHA cases;
      property test — output is a valid range and monotonic in ctx and ngl.
    - Flag registry / command builder: golden command strings; deprecated/absent flag
      filtering; exporter output (sh, systemd) golden files.
    - Preset store: migrations v1→v2, atomic-write failure injection, round-trip of
      unknown flags.
  * Integration:
    - Supervisor vs a fake-server.sh fixture: emits \r progress lines, ANSI colors,
      delayed /health 503→200, configurable exit codes. Asserts: line assembly, state
      machine transitions, teardown within timeout, pidfile lifecycle, orphan adoption.
    - Telemetry poller vs a mock HTTP server (canned /slots, /metrics payloads).
  * UI:
    - Golden frame snapshots per screen and theme; focus-order traversal tests; palette
      filtering; autoscroll-pause interaction tests.
  * Compat matrix (manual checklist per release, automated where feasible): tmux, kitty,
    ghostty, wezterm, alacritty, VSCode integrated terminal — braille width, box glyphs,
    OSC 52, truecolor.

9. Implementation Milestones

 Every phase ends with an explicit EXIT CRITERION. The walking skeleton lands in Phase 1:
 end-to-end truth in week one beats four perfect phases meeting for the first time in
 month two. Each bullet below is a branch-sized WORK ITEM — one branch, one mergeable
 deliverable. The full branch/commit/merge/verify loop is specified in AGENTS.md.

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
 | D3 | PTY default, pipe fallback                | Color + \r fidelity; degrade gracefully          |
 | D4 | Single managed instance (v1)              | Scope control; schema ready for multi later      |
 | D5 | Headless core + UI shell + CLI            | Testability, free CLI, framework risk insurance  |
 | D6 | OSC 52 clipboard primary                  | Works over SSH; local tool fallbacks             |
 | D7 | No "pause" feature                        | SIGSTOP holds VRAM hostage; footgun removed      |
 | D8 | Braille/ASCII spinners only               | Emoji width varies by terminal emulator          |
 | D9 | Flag registry + --help runtime validation | llama-server flags drift across releases         |
 | D10| mockup = style guide, not layout contract | CSS artifacts (radius, grids, hover) don't map   |
