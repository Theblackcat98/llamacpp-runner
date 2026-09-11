# PR Plan — Phase 9: Persistence and Concurrency Hardening

Status: archived (2026-09-11) — automated EXIT green; manual evidence tracked in ../manual-verification-checklist.md
Source: `plans/audit-remediation-roadmap.md`
Spec references: `plans/llamamanager.md` §5, §6.3, §9

## Objective

Make JSON storage safe under crashes, interrupted writes, and concurrent CLI/TUI access.

## In scope

- Replace fixed temporary filenames with unique same-directory temporary files.
- Introduce shared atomic-write helpers.
- Decide and document fsync durability behavior.
- Preserve and recover backups safely.
- Recover from interrupted writes.
- Add file locking or a single-writer policy.
- Validate pidfile fields and process ownership assumptions.
- Prevent races from deleting or replacing another process’s pidfile.

## Out of scope

- Changing JSON to SQLite.
- New preset features.
- Cross-platform process inspection implementation.

## Tests

- Concurrent config/preset writes.
- Injected write, rename, and durability failures.
- Crash points before and after rename.
- Backup retention and recovery.
- Invalid schema and pidfile records.
- Two writers do not silently lose updates.

## EXIT criterion

The last valid configuration remains recoverable through injected failures, temporary files cannot become canonical accidentally, and concurrent writers cannot cross-rename each other’s data.
