# PR Plan — Phase 11: Model Discovery and GGUF Robustness

Status: archived (2026-09-11) — automated EXIT green; manual evidence tracked in ../manual-verification-checklist.md
Source: `plans/audit-remediation-roadmap.md`
Spec references: `plans/llamamanager.md` §3.1, §3.2, §7, §8

## Objective

Make recursive model discovery reliable for changing directories, corrupt files, hostile headers, and nested model trees.

## In scope

- Add GGUF count and allocation limits.
- Preserve u64 precision and reject unsafe loop bounds.
- Distinguish unsupported types from truncation.
- Surface unreadable directories and scan errors.
- Define symlink behavior.
- Strengthen cache invalidation beyond rounded timestamps.
- Avoid creating worker pools for fully cached scans.
- Harden worker failure and replacement behavior.
- Make watchers recursive or trigger rescans on directory changes.
- Surface watcher errors.
- Preserve existing rows during scans.
- Block incomplete split models from launch/configuration.

## Out of scope

- New model formats.
- Remote model registries.
- Estimator redesign.

## Tests

- Adversarial huge-count fixtures.
- Unsupported GGUF type diagnostics.
- Nested directory changes.
- Unreadable path reporting.
- Same-size replacement cache invalidation.
- Worker failure and empty-job behavior.
- Incomplete split model launch blocking.

## EXIT criterion

A changing recursive model tree remains accurate and explainable without crashes, unbounded allocations, stale cache entries, or launchable incomplete models.
