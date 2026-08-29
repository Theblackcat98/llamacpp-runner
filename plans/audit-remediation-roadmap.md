# llama-runner Audit Remediation Roadmap

Status: proposed
Source: repository audit performed 2026-08-28
Scope: correctness, safety, integration gaps, persistence, portability, and UX issues found after the original Phase 1–5 implementation.

This roadmap intentionally treats the existing phase reports as historical implementation records, not proof that the current product is complete. The current suite has 375 passing tests and 3 failing tests, plus React `act(...)` warnings and an EventEmitter listener warning.

## Delivery rules

- One phase below is one pull request.
- Each PR must include tests first, implementation, docs updates, and the relevant EXIT criterion.
- Core changes and UI changes should remain isolated unless the integration itself is the work item.
- Run `bun run lint && bun run typecheck && bun test` before merging each PR.
- Do not archive a phase until its EXIT criterion is green from `main`.
- Preserve the single-instance rule and the shared teardown path.

## Phase 6 — Lifecycle and Safety Correctness

### Goal
Make every managed process follow one reliable, cancellable, restartable lifecycle and restore the safety guarantees promised by the specification.

### PR scope

- Fix the three currently failing process/telemetry integration tests.
- Make `Supervisor` restartable after a clean or failed exit.
- Add explicit start/teardown cancellation state so kill during startup is safe and bounded.
- Prevent READY/log events after teardown or process exit.
- Ensure spawn errors become typed failure states without hanging callers.
- Route all process launches, including CLI `start`, through the shared supervisor/session teardown path.
- Ensure CLI start uses pidfile lifecycle, port preflight, failure classification, and SIGINT → wait ≤5 s → SIGKILL.
- Make concurrent teardown and repeated shutdown idempotent.
- Remove ad-hoc signal handling from CLI.

### Tests

- Supervisor restart after exit.
- Kill during preflight and spawn.
- Late log after teardown is ignored.
- CLI start receives SIGINT and escalates correctly.
- CLI start writes and clears pidfile.
- CLI and TUI use equivalent lifecycle behavior.
- Existing fake-server telemetry and CLI-kill tests pass reliably.

### EXIT criterion

`bun test` passes with no process-related timeouts; a fake server can be launched, observed, stopped, restarted, and forcibly killed without an orphan or stale pidfile.

## Phase 7 — Real Telemetry Integration

### Goal
Connect the implemented telemetry core to the running TUI so the Server Telemetry screen reflects the actual managed server.

### PR scope

- Wire `HealthPoller`, `SlotsPoller`, `MetricsPoller`, and `createTelemetryMonitor` from the session/application composition root.
- Add telemetry state to the typed event bus or a clearly documented state-upstream adapter.
- Start and stop pollers with the managed supervisor lifecycle.
- Pass real `serverRunning` state to `App`.
- Implement READY/LOADING/FAILED/IDLE rendering from live state.
- Display live endpoint, uptime, failure tail, metrics, slots, and health status.
- Make telemetry toggle actually update launch flags and poller lifecycle.
- Prevent stale poll responses from affecting a later launch generation.
- Isolate subscriber exceptions so one render callback cannot stop a poller.

### Tests

- Composition-level test: launch → poll → READY → metrics/slots updates → kill.
- Pollers stop on shutdown and restart cleanly.
- Stale generation responses are ignored.
- UI receives actual `serverRunning` state.
- Toggle telemetry changes both argv and screen behavior.
- No callback exception permanently stops polling.

### EXIT criterion

A fake HTTP server plus fake process drives the real TUI state from STARTING through LOADING to READY, displays metrics and slots, and returns to IDLE after teardown.

## Phase 8 — Configuration, Preset, and Binary Completeness

### Goal
Make persistence and configurator features match what the UI and schema advertise.

### PR scope

- Wire preset load into the configurator.
- Implement relink flow for broken presets.
- Restore `lastSession` tab and preset on startup.
- Update UI state immediately after saving a preset.
- Add delete confirmation.
- Separate explicit default preset from last-session state, or document and consistently implement the chosen semantics.
- Use `binary_path` in launch plans and CLI/TUI startup.
- Connect runtime `--help` validation to configurator field availability and deprecation warnings.
- Render all supported registry-backed fields or deliberately remove unsupported registry entries.
- Normalize/expand `~`, relative paths, and platform paths consistently.
- Validate models directory before saving it.
- Add schema validation for config and presets.
- Capture the original schema version before migration.

### Tests

- Preset load updates every configurator field.
- Broken preset relink and re-save.
- Startup restores last session.
- Save updates visible rows immediately.
- Invalid JSON shapes are rejected safely.
- Migration reports the true source version and preserves backups.
- Alternate binary path is used by both CLI and TUI.
- Tilde and relative paths resolve consistently.

### EXIT criterion

A user can select a model, configure it, save a preset, quit, relaunch, load it, relink it after a move, and launch the selected binary with the same command shown in the preview.

## Phase 9 — Persistence and Concurrency Hardening

### Goal
Make JSON storage durable and safe under crashes and concurrent CLI/TUI access.

### PR scope

- Replace fixed `.tmp` files with unique same-directory temporary files.
- Add collision-safe atomic write helpers shared by config, presets, pidfile, and metadata cache.
- Decide and document fsync durability behavior.
- Preserve previous backups instead of overwriting blindly.
- Handle interrupted writes and recover safely.
- Add file locking or a single-writer strategy for presets/config.
- Validate pidfile fields and reject invalid PIDs/records.
- Avoid deleting another process’s pidfile during races.
- Add safe backup/restore diagnostics.

### Tests

- Concurrent save attempts.
- Injected write, rename, and fsync failures.
- Crash points before and after rename.
- Backup retention and recovery.
- Invalid schema and pidfile records.
- Two CLI/TUI writers do not lose updates silently.

### EXIT criterion

Injected failures leave the last valid document recoverable, no temporary file is mistaken for the canonical document, and concurrent writers cannot cross-rename each other’s data.

## Phase 10 — Portability and Process Identity

### Goal
Remove Linux-only assumptions and reduce false-positive/false-negative orphan handling.

### PR scope

- Introduce a process-inspection abstraction.
- Provide Linux `/proc` implementation and safe unsupported-platform behavior.
- Improve process identity validation using command, owner, port, and start identity where available.
- Handle `localhost`, IPv4, IPv6, wildcard IPv6, and interface exposure consistently.
- Expand host exposure confirmation beyond exact `0.0.0.0`.
- Make orphan adoption require the expected process/endpoint relationship.
- Clarify behavior when permissions prevent inspection or signaling.
- Document platform support and limitations.

### Tests

- Mock process-inspection backends for Linux, macOS, Windows, and unsupported environments.
- PID reuse and mismatched process tests.
- Wrong-port and closed-port orphan tests.
- IPv4/IPv6 preflight tests.
- Permission-denied behavior.
- Public-interface warning tests.

### EXIT criterion

Orphan detection never silently claims a valid process is stale solely because `/proc` is unavailable, and it refuses mismatched processes or endpoints without risking an unrelated kill.

## Phase 11 — Model Discovery and GGUF Robustness

### Goal
Make scanning reliable for real directories, hostile/corrupt files, nested trees, and changing model sets.

### PR scope

- Add parser count and allocation limits for hostile headers.
- Preserve u64 count precision and reject unsafe loop bounds.
- Distinguish unsupported GGUF types from truncation.
- Reuse parsing allocations where useful.
- Surface unreadable directories and scan errors.
- Define symlink policy and document it.
- Make cache signatures resistant to timestamp precision/content replacement issues.
- Avoid worker-pool creation for fully cached scans.
- Harden worker failure/replacement behavior.
- Make watcher behavior recursive or rescan on directory changes.
- Handle watcher errors through scan state.
- Preserve existing rows while a rescan is in progress.
- Block incomplete split models from launch/configuration.

### Tests

- Huge count/header adversarial fixtures.
- Unsupported type diagnostics.
- Nested directory create/rename/delete watcher tests.
- Unreadable path reporting.
- Cache invalidation for same-size replacements.
- Worker failure and empty-job tests.
- Incomplete split model cannot launch.

### EXIT criterion

A changing recursive model tree produces accurate, explainable state without crashes, unbounded allocations, stale cache entries, or launchable incomplete models.

## Phase 12 — Command, Estimation, and Runtime Compatibility

### Goal
Ensure generated commands and estimates are accurate, compatible, and honest about uncertainty.

### PR scope

- Connect runtime help validation to command generation, not only display metadata.
- Make unavailable/deprecated flags impossible to launch accidentally.
- Improve shell and systemd escaping with format-specific rules.
- Quote Explorer previews using the same command-line formatter as exports.
- Centralize defaults and runtime constants.
- Calculate K and V cache memory independently.
- Include batch/ubatch effects in compute-buffer estimates or explicitly remove the claim.
- Use consistent GiB/GB labels throughout the UI.
- Add architecture-specific estimator limitations and confidence notes.
- Clamp/validate preset values before command generation.

### Tests

- Paths and environment values containing spaces, quotes, `%`, backslashes, and newlines.
- Runtime flag unavailable/deprecated behavior.
- K/V mixed precision estimates.
- Batch-size sensitivity.
- Unit-label consistency.
- Hand-edited invalid preset flags.

### EXIT criterion

The displayed command, exported command, and spawned argv are byte-for-byte equivalent where applicable; unsupported flags are visibly blocked; estimates are internally consistent and clearly labeled as estimates.

## Phase 13 — Keyboard, Focus, and UI Integration

### Goal
Make the TUI’s advertised interactions work consistently without duplicate handlers or leaks.

### PR scope

- Choose one owner for global Enter, quit, kill, and field navigation events.
- Remove duplicate `useKeyboard` handling and eliminate listener leaks.
- Fix React `act(...)` warnings in UI tests.
- Wire theme provider and runtime theme switching.
- Reconcile the four-tab spec with the Catalog tab and palette actions.
- Wire preset load/relink callbacks.
- Add visible labels and controlled value synchronization to text inputs.
- Ensure screen changes remap focus correctly.
- Add explicit modal/inline confirmation states for host exposure, kill, quit, and delete.
- Show live process status in the shell header.
- Preserve stderr identity in the console.

### Tests

- One keypress produces one action.
- Mount/unmount cycles do not increase key listener count.
- Theme switching changes every screen.
- Focus traversal across each screen.
- Input reset/load/model-change synchronization.
- Confirmation modal acceptance/cancellation.
- UI tests complete without `act(...)` warnings.

### EXIT criterion

Every documented keybinding has one working owner, every advertised action is wired, and the full UI suite runs without listener or React update warnings.

## Phase 14 — UX, Layout, and Release Readiness

### Goal
Turn the technically complete tool into a predictable daily-use terminal application.

### PR scope

- Add model and preset search/filtering.
- Add useful sorting options.
- Add scan progress, elapsed time, cache-hit status, and actionable errors.
- Truncate long paths/names with consistent ellipses and provide full-value inspection.
- Rework fixed widths/heights for 100x30 and wider terminals.
- Validate all five-tab/catalog layouts at narrow widths.
- Add explicit “server exposed to network” warning and security guidance.
- Add terminal compatibility checklist and test instructions.
- Align package name, UI branding, docs, version, and GitHub repository naming.
- Update stale phase reports that claim green status.
- Add a README with installation, prerequisites, supported platforms, binary setup, examples, and limitations.

### Tests/manual checks

- Narrow and wide golden frames.
- 100x30, 120x40, and 200x60 layouts.
- Long model names and paths.
- Hundreds of models/presets.
- tmux, kitty, ghostty, wezterm, alacritty, and VS Code terminal checklist.
- One-hour real llama-server soak with no orphan and stable memory.

### EXIT criterion

The release checklist is complete, the full suite is green and warning-free, manual terminal compatibility is signed off, and documentation accurately describes the shipped behavior.

## Archive policy

- `plans/llamamanager.md` remains the specification of record until superseded by an explicit versioned spec.
- Existing `plans/prd-phase-1-walking-skeleton.md` and `plans/prd-phase-2-widget-library.md` should be moved to `plans/archive/` only after their phase gates are independently verified from current `main`.
- `docs/phase5-report.md` and `docs/error-audit.md` are historical reports and should not be treated as current completion evidence while the suite is failing.
