# PR Plan — Phase 12: Command, Estimation, and Runtime Compatibility

Status: archived (2026-09-11) — automated EXIT green; manual evidence tracked in ../manual-verification-checklist.md
Source: `plans/audit-remediation-roadmap.md`
Spec references: `plans/llamamanager.md` §3.2–§3.3, §3.5, §8

## Objective

Ensure commands and estimates are accurate, compatible with the detected llama-server binary, and honest about uncertainty.

## In scope

- Connect runtime help validation to command generation.
- Prevent unavailable/deprecated flags from launching accidentally.
- Implement format-specific shell and systemd escaping.
- Use the same quoting formatter for Explorer previews and exports.
- Centralize defaults and runtime constants.
- Calculate K and V cache memory independently.
- Include batch/ubatch effects or remove unsupported estimator claims.
- Standardize GiB/GB labels.
- Document architecture-specific estimator limitations.
- Validate hand-edited values before command generation.

## Out of scope

- New llama-server flags not required by current product scope.
- New exporters.
- UI redesign beyond displaying compatibility state.

## Tests

- Quoting paths and values containing spaces, quotes, `%`, backslashes, and newlines.
- Unavailable/deprecated runtime flags.
- Mixed K/V precision estimates.
- Batch-size sensitivity.
- Unit-label consistency.
- Invalid hand-edited values.

## EXIT criterion

The displayed command, exported command, and spawned argv are equivalent where applicable; unsupported flags are blocked; estimates are internally consistent and labeled as estimates.
