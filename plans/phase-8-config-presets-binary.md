# PR Plan — Phase 8: Configuration, Presets, and Binary Completeness

Status: planned
Source: `plans/audit-remediation-roadmap.md`
Spec references: `plans/llamamanager.md` §3.3, §3.4, §5, §7, §9 Phase 4

## Objective

Make persistence and configurator behavior match the features advertised by the UI and schema.

## In scope

- Wire preset load into the configurator.
- Implement broken-preset relinking.
- Restore `lastSession` tab and preset on startup.
- Update visible preset state immediately after save.
- Add preset-delete confirmation.
- Clarify or separate default-preset and last-session semantics.
- Honor `binary_path` in TUI and CLI launch plans.
- Connect `--help` validation to field availability and deprecation warnings.
- Render all supported registry-backed fields or explicitly remove unsupported entries.
- Normalize and expand `~`, relative, and platform paths.
- Validate model directories before saving.
- Add config/preset document shape validation.
- Capture the original migration version before migration.

## Out of scope

- Concurrent-write hardening.
- Cross-platform process identity.
- New model parser behavior.

## Tests

- Loading a preset updates every configurator field.
- Broken preset relinks and persists.
- Last session restores on boot.
- Save updates rows immediately.
- Invalid config/preset shapes fail safely.
- Migration reports the true source version.
- Alternate binary path is used by both frontends.
- Tilde and relative paths resolve consistently.

## EXIT criterion

A user can select, configure, save, quit, relaunch, load, relink, and launch a preset with the selected binary and the exact command shown in the preview.
