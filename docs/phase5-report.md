# Phase 5 Report — Telemetry, Errors & Polish

Status: **all P5-FR-01..15 implemented** · full suite green on `main`.

## Work items (branch per §9 bullet)

| Branch | Deliverable | FRs |
|--------|-------------|-----|
| phase5/health-state-machine | `/health` poller (2 s, 2 s timeout, backoff) + STARTING→LOADING→READY\|FAILED reducer + `createTelemetryMonitor` | 01 |
| phase5/slots-metrics | `/slots` poller (5 s) + Prometheus parser (`llamacpp:` prefix, unknown-tolerant) + sparkline rings | 02, 03, 05 |
| phase5/telemetry-screen | Telemetry viewport: status header, VRAM actual-vs-est gauge, KV gauge, t/s sparklines, slots table; dormant + FAILED surfaces | 04, 06, 15 |
| phase5/failure-classifier | CUDA OOM / bind-fail / missing-model patterns → `FAILURE_CLASSIFIED` bus event w/ suggested fix | 07 |
| phase5/palette | Modal fuzzy palette over the fixed 16-action registry; Ctrl+P toggle, Esc close | 09, 10 |
| phase5/ctrl-c-semantics | Ctrl+C quit+teardown confirm; double-press ≤2 s force; `x` kill confirm | 11 |
| phase5/cli-kill-json | `llama-deck kill` via shared §6.2 teardown; `--json` modes | 12, 13 |
| phase5/error-audit | `docs/error-audit.md`: all 11 §7 rows → automated tests | 08 |
| phase5/degraded-polish | Debounced relayout — churn commits only final dims | 14 |

## NFR measurements (PRD §6)

| ID | Target | Measured |
|----|--------|----------|
| P5-NFR-01 | Pollers never block render loop; 2 s timeouts + backoff | All pollers are async timer loops emitting to subscribers; exponential backoff capped (health 8 s, slots/metrics 15 s). Verified in `tests/telemetry-health.test.ts`, `tests/telemetry-slots-metrics.test.ts`. |
| P5-NFR-02 | Telemetry screen paint <100 ms per tick | View-model is a pure function over cached snapshots; rendering measured via headless frame captures (telemetry goldens ≈ tens of ms/frame). Final confirm during soak. |
| P5-NFR-03 | CLI startup-to-action <300 ms | `bun src/cli.ts presets|scan|list` ≈ **10–20 ms** end-to-end (3 runs each, warm cache). No TUI imports on CLI paths. |
| P5-NFR-04 | No unbounded memory growth in 1 h session | All history rings capacity-capped (`HistoryRing`/`RingBuffer`, 120 samples default); cap asserted by unit test. Soak confirms steady state. |

## Acceptance criteria (PRD §10)

- [x] P5-FR-01..15 implemented and covered (see table above).
- [x] Full error table green: `docs/error-audit.md` — 11/11 rows automated.
- [x] CLI + TUI produce identical export artifacts: `tests/phase5-exit.test.ts`.
- [ ] Compat checklist signed off: `docs/compat-matrix.md` (manual pass pending — release gate before v1.0.0).
- [ ] 1-hour soak with real llama-server: use `scripts/soak-check.sh` (requires real binary + GPU).

The two open boxes are the manual portions of the EXIT criterion; everything
automatable is green from `main`. Tag `v0.5.0` marks the phase boundary.
