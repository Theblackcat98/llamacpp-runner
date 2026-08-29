# PR Plan — Phase 6: Lifecycle and Safety Correctness

Status: planned
Source: `plans/audit-remediation-roadmap.md`
Spec references: `plans/llamamanager.md` §6.1–§6.4, §9 Phase 5 EXIT

## Objective

Make every managed process restartable, cancellable, idempotently tear-downable, and consistently managed by the shared supervisor/session path.

## In scope

- Fix the failing fake-server telemetry integration tests and CLI kill integration.
- Make `Supervisor` restartable after exit.
- Make startup cancellation and teardown during preflight/spawn safe and bounded.
- Ignore late output and duplicate exit events after teardown.
- Preserve typed failure states without hanging or leaking child processes.
- Route CLI `start` through the shared session/supervisor lifecycle.
- Remove CLI ad-hoc signal handling.
- Keep pidfile creation/removal and exactly-one-instance enforcement centralized.

## Out of scope

- New telemetry UI wiring.
- Cross-platform process inspection.
- Persistence redesign.
- New CLI commands.

## Implementation approach

1. Add failing unit/integration tests for restart, cancellation, duplicate teardown, late output, and CLI start teardown.
2. Define explicit supervisor lifecycle states and a launch generation/token.
3. Ensure every start creates a fresh transport and resets per-run state only after the previous run is fully settled.
4. Ensure a teardown request made before transport creation is honored immediately after transport creation.
5. Ensure all teardown paths share one promise and always settle, including spawn errors and missing transports.
6. Move CLI start composition onto `createSession` or a shared foreground-run helper.
7. Keep signal registration in the shared cleanup module only.
8. Update docs and stale phase status claims.

## Tests

- Supervisor starts, exits, and starts again.
- Kill during port preflight.
- Kill during delayed spawn.
- Concurrent `kill()`/`teardown()` calls return the same result.
- Late data cannot emit READY after exit.
- CLI start handles SIGINT and escalates to SIGKILL.
- CLI start writes and removes the pidfile.
- Existing supervisor orphan/teardown suite.

## EXIT criterion

`bun run lint && bun run typecheck && bun test` passes with no process-related timeout. A fake server can be launched, observed, stopped, restarted, and forcibly killed without an orphan or stale pidfile.
