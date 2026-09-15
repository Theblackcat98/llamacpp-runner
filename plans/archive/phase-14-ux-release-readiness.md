# PR Plan — Phase 14: UX, Layout, and Release Readiness

Status: complete (Verified 2026-09-15, Commits 634d18d, docs/compat-matrix.md signed off, 490 tests green)
Source: `plans/audit-remediation-roadmap.md`
Spec references: `plans/llamamanager.md` §2.1, §7, §8, §9

## Objective

Make the completed tool predictable for daily terminal use and ensure release documentation accurately reflects shipped behavior.

## In scope

- Add model and preset filtering.
- Add useful sort modes.
- Show scan progress, elapsed time, cache hits, and actionable errors.
- Truncate long paths/names consistently and expose full values on demand.
- Rework fixed widths/heights for minimum and wide terminals.
- Validate all layouts at 100x30, 120x40, and 200x60.
- Warn clearly when the server is exposed to the network.
- Complete terminal compatibility checklist and instructions.
- Align package name, UI branding, docs, version, and GitHub naming.
- Correct stale phase reports and status claims.
- Add or update README installation, prerequisites, supported platforms, examples, and limitations.

## Out of scope

- New server functionality.
- Multi-instance management.
- Authentication implementation.

## Tests/manual checks

- Narrow and wide golden frames.
- Long model names and paths.
- Hundreds of models and presets.
- tmux, kitty, ghostty, wezterm, alacritty, and VS Code terminal checks.
- One-hour real llama-server soak with stable memory and no orphan.

## EXIT criterion

The release checklist is complete, the suite is green and warning-free, manual terminal compatibility is signed off, and documentation accurately describes the shipped behavior.
