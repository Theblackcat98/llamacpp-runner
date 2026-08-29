# PR Plan — Phase 7: Real Telemetry Integration

Status: planned
Source: `plans/audit-remediation-roadmap.md`
Spec references: `plans/llamamanager.md` §3.5, §2.4, §7, §9 Phase 5

## Objective

Connect the existing health, slots, metrics, and telemetry state-machine code to the running TUI so the telemetry screen reflects the actual managed server.

## In scope

- Compose `HealthPoller`, `SlotsPoller`, `MetricsPoller`, and `createTelemetryMonitor` from the application/session layer.
- Route telemetry state upward through typed events or a documented typed adapter.
- Start and stop pollers with the supervisor lifecycle.
- Pass real `serverRunning` state to `App`.
- Render live STARTING, LOADING, READY, FAILED, and IDLE states.
- Display real endpoint, uptime, failure tail, metrics, and slots.
- Make telemetry enable/disable affect launch flags and poller lifecycle.
- Add launch-generation protection against stale poll results.
- Prevent subscriber exceptions from stopping pollers.

## Out of scope

- New metrics beyond the current model.
- Process portability.
- Estimator redesign.

## Tests

- Composition test covering launch through health READY.
- Metrics and slots updates reach the screen view model.
- Pollers stop on shutdown and restart cleanly.
- Stale generation responses are ignored.
- Telemetry toggle changes argv and screen state.
- Subscriber exceptions do not terminate polling.

## EXIT criterion

A fake process and HTTP server drive the real application from STARTING through LOADING to READY, show metrics and slots, and return to IDLE after teardown.
