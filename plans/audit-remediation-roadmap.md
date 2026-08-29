# llama-deck Production Remediation and Archive Plan

Status: active
Source audits: `plans/production-readiness-audit.md`, 2026-08-28
Specification of record: `plans/llamamanager.md`

## Current baseline

The audit documents described a red suite and disconnected UI wiring. That snapshot is stale: on the current `main`, verification completed on 2026-08-28 with:

- `bun run lint` — pass
- `bun run typecheck` — pass
- `bun test` — **423 passed, 0 failed** across 76 files
- import boundary and supervisor/orphan integration coverage — pass

The implementation history also contains completed remediation work through Phases 6–13. The remaining work is primarily release-readiness validation, documentation reconciliation, and deciding whether the Catalog artifact remains a supported development screen or is removed from the production surface.

## Non-negotiable archive rule

A PRD or phase document may be moved to `plans/archive/` only after its own EXIT criterion is verified from the current `main`. Passing tests alone is insufficient where the criterion explicitly requires manual terminal checks, a real llama-server soak, or documentation sign-off.

For every phase:

1. Verify the phase-specific automated tests from `main`.
2. Run `bun run lint && bun run typecheck && bun test`.
3. Complete the phase-specific manual/integration evidence.
4. Update the phase document from `planned` to `complete`, recording date, commit, and evidence.
5. Move the phase document and its matching PRD (if present) to `plans/archive/` in the same documentation change.
6. Re-run the full suite after moves; archive only if still green.

`plans/llamamanager.md` remains active as the specification of record and is never archived by this plan. The two already archived Phase 1 and Phase 2 PRDs remain archived. Do not use the old audit's historical “done” labels as evidence.

## Remediation order and gates

### Phase 6 — Lifecycle and Safety Correctness

**Scope:** supervisor restart/cancellation, late-event suppression, typed spawn failures, shared CLI/TUI teardown, pidfile lifecycle, idempotent shutdown.

**Required evidence:** supervisor restart, kill during preflight/spawn, late output suppression, CLI SIGINT escalation, pidfile create/clear, orphan/teardown suite.

**EXIT:** fake server starts, reaches observed state, stops, restarts, and is force-killed without timeout, orphan, or stale pidfile.

**Current assessment:** implementation and automated coverage pass; archive after recording the current full-suite and mandatory teardown evidence.

### Phase 7 — Real Telemetry Integration

**Scope:** composition-root pollers, typed state-upstream wiring, lifecycle coupling, live endpoint/status/metrics/slots, telemetry toggle, generation safety, subscriber isolation.

**Required evidence:** launch → STARTING/LOADING → READY with real application state, metrics and slots visible, teardown → IDLE, non-default endpoint, stale response, and callback failure tests.

**EXIT:** fake process plus HTTP server drives the real TUI through the complete lifecycle.

**Current assessment:** core tests pass, but explicitly re-verify non-default host/port and the rendered TUI path before archive.

### Phase 8 — Configuration, Presets, and Binary Completeness

**Scope:** preset load/relink/save/delete, last-session restoration, default-vs-last-session semantics, binary path, runtime help availability, registry-backed fields, path normalization, schema validation, migration source version.

**Required evidence:** end-to-end select/configure/save/relaunch/load/relink/launch; exact preview/spawn argv parity; invalid JSON and migration tests; alternate binary and path tests.

**EXIT:** the selected preset and binary survive restart and produce the exact previewed command.

**Current assessment:** automated Phase 8 coverage passes; archive only after a current TUI restart/relink walkthrough is recorded.

### Phase 9 — Persistence and Concurrency Hardening

**Scope:** unique same-directory temp files, shared atomic writes, durability decision, backup retention/recovery, interrupted writes, locking/single-writer policy, pidfile race safety.

**Required evidence:** concurrent writers, injected write/rename/fsync failures, crash points, backup recovery, invalid pidfile records, and no cross-rename/lost update.

**EXIT:** last valid data remains recoverable and concurrent writers cannot corrupt or silently overwrite one another.

**Current assessment:** implementation history and tests indicate completion; confirm the documented durability and concurrency policy before archive.

### Phase 10 — Portability and Process Identity

**Scope:** process-inspection abstraction, Linux implementation, unsupported-platform behavior, identity/endpoint checks, IPv4/IPv6/exposure handling, safe adoption/signaling.

**Required evidence:** mocked platform backends, PID reuse, mismatches, wrong ports, IPv4/IPv6, permission denial, public-interface warnings.

**EXIT:** unavailable `/proc` never silently marks a valid process stale; mismatched processes/endpoints are refused without unrelated kills.

**Current assessment:** core safeguards pass; archive only after platform-matrix evidence and explicit unsupported-platform behavior are documented.

### Phase 11 — Model Discovery and GGUF Robustness

**Scope:** hostile-header limits, u64 safety, type/truncation diagnostics, scan errors, symlink policy, cache invalidation, worker/watcher resilience, incomplete split-model blocking.

**Required evidence:** adversarial fixtures, nested changes, unreadable paths, same-size replacement, worker failures, empty jobs, incomplete launch blocking.

**EXIT:** changing recursive trees remain accurate and explainable without unbounded allocation, stale cache, crashes, or launchable incomplete models.

**Current assessment:** automated hardening coverage passes; archive after recording recursive watcher and error-state evidence.

### Phase 12 — Command, Estimation, and Runtime Compatibility

**Scope:** runtime help gating, format-specific escaping, preview/export parity, centralized defaults, independent K/V estimates, batch effects, units, limitations, preset sanitization.

**Required evidence:** hostile quoting inputs, unavailable/deprecated flags, mixed precision, batch sensitivity, units, invalid hand-edited values.

**EXIT:** displayed/exported/spawned commands are equivalent where applicable, unsupported flags cannot launch, and estimates are consistently labeled and internally coherent.

**Current assessment:** automated coverage passes; archive after reviewing generated artifacts against a real configured binary.

### Phase 13 — Keyboard, Focus, and UI Integration

**Scope:** single key owner, listener cleanup, warning-free React updates, themes, four-tab product surface, preset callbacks, controlled inputs, focus remapping, confirmations, live process/stderr identity.

**Required evidence:** one-action-per-keypress, mount/unmount listener counts, all-theme switching, focus traversal, input synchronization, confirmation accept/cancel, warning-free UI suite.

**EXIT:** every documented binding has one owner, every advertised action is wired, and UI tests have no React/listener warnings.

**Current assessment:** automated UI coverage passes. Resolve the product decision around Catalog before declaring the four-tab criterion complete: remove/gate the development Catalog, or explicitly amend the spec and ship it as a supported fifth tab.

### Phase 14 — UX, Layout, and Release Readiness

**Scope:** filtering/sorting, scan progress/errors, truncation/full-value inspection, 100x30/120x40/200x60 layouts, exposure warning, terminal compatibility, branding/docs/version, stale reports, README, real-server soak.

**Required evidence:** golden frames at all target sizes, large model/preset sets, terminal checklist for tmux/kitty/ghostty/wezterm/alacritty/VS Code, one-hour real llama-server soak, and documentation review.

**EXIT:** release checklist complete, suite green and warning-free, manual compatibility signed off, and docs describe shipped behavior.

**Current assessment:** open release gate. This is the final blocker for archiving the audit/remediation plan itself.

## Audit finding disposition

- **F1/F2/F3/F4/F6:** treat as closed only with current composition/TUI evidence; retain regression tests.
- **F5:** unresolved product-surface decision; must be removed/gated or explicitly specified before Phase 13/14 archive.
- **F7/F7b/F8–F10/F12–F19:** map to Phases 8, 12, 13, and 14 above; do not mark closed from unit tests alone where the finding concerns visible wiring or onboarding.
- Historical documents (`docs/phase5-report.md`, `docs/error-audit.md`) must be corrected or clearly marked historical before release sign-off.

## Archive sequence

Archive in dependency order, never in bulk:

1. Verify and archive Phase 6.
2. Verify and archive Phase 7.
3. Verify and archive Phase 8.
4. Verify and archive Phase 9.
5. Verify and archive Phase 10.
6. Verify and archive Phase 11.
7. Verify and archive Phase 12.
8. Resolve Catalog and complete the Phase 13 gate; then archive Phase 13 and its Phase 5/related PRD only if its independent EXIT is green.
9. Complete Phase 14 release evidence; archive Phase 14 and the remaining audit/remediation records only after docs and manual sign-off are complete.

The original PRDs `prd-phase-3` through `prd-phase-5` are archived only when their original EXIT criteria are independently re-run against current `main`; remediation completion does not automatically prove the original PRD. Keep the active spec and current release checklist outside `plans/archive/`.

## Definition of done for this plan

- Every audit finding has a closed, deferred, removed, or explicitly accepted disposition.
- Every phase has current automated and required manual evidence.
- No stale document claims a green phase without evidence.
- `bun run lint && bun run typecheck && bun test` passes with zero failures and zero warnings.
- Required terminal compatibility and real-server soak checks are signed off.
- Only then are completed PRDs/phases moved to `plans/archive/`.
