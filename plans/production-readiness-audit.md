# Production-Readiness & UX Audit — llama-deck

> Audit date: 2026-08-28. Remediation completed: 2026-09-15.
> Status: **ALL 19 FINDINGS (F1–F19) RESOLVED & VERIFIED GREEN**.
> Test suite: **490 passing, 0 failing, 0 warnings** across 93 files.
> Automated release verification suite: `tests/automated-manual/` (11 suites, 38 tests).
> Terminal compatibility: `docs/compat-matrix.md` signed off. Root `README.md` added.

---

## A. Executive Assessment (Historical Snapshot vs Post-Remediation)

**Historical audit note (2026-08-28):** Initially described an unfinished UI wiring layer and failing golden tests.
**Resolution (2026-09-15):** All 19 findings have been addressed, fully tested, and integrated. Golden frames are updated and passing. Keybindings, theme switching, presets, telemetry endpoint re-pointing, process supervision, error classification, and release documentation are complete and verified. The architecture adheres strictly to D5 (headless core + React TUI + CLI).

What makes it "feel not polished" is concentrated in the **UI wiring layer**
(`src/main.tsx` ↔ `src/ui/app.tsx`): several advertised features are *implemented in components but never
connected to handlers*, and a central safety signal is dropped on the floor. A new user will hit dead
keybindings, an unreachable theme switcher, a Presets tab they cannot use to launch, a Telemetry tab that
never populates if they change the port, and a confusing developer "Catalog" tab. These are high-leverage
fixes — most are a few lines of wiring.

---

## B. User Journey Audit (first launch → normal use)

| Stage | What happens | Friction |
|---|---|---|
| Install | `bun install`; runtime pinned to `bun@1.3.2`. No install README, no binary hint. | Undiscoverable that `llama-server` must be on PATH. |
| First launch | Boots to Explorer. `modelsDir === null` → WELCOME box: "[s] use ~/models/llm". | Only way to set a dir is the `s` key (undocumented in footer); no prompt field; `default_model_dir` ignored. |
| Setup | Press `s` → scans `~/models/llm`. If empty/unset, silent. | No "no .gguf files found" message for a *configured* empty dir. |
| First use | Select model → fills Configurator. Press Enter to launch. | Launch hidden-depends on having selected in Explorer; Enter on Configurator with no model = silent log-only failure. |
| Normal use | Configurator, Telemetry, Presets tabs. | Telemetry tab stays empty if port ≠ 8080 (F2). Presets tab can't load/launch (F3). Theme switcher dead (F4). `x` kill dead (F1). |
| Errors | Server fails (bad binary/port/OOM). | Generic message; binary-not-found detail dropped (F6). |
| Recovery | Orphan at boot. | Only `k` kills; "adopt" never implemented (F8). |
| Restart | Re-open app. | lastSession preset/tab/theme never restored (F9). |

---

## C. Findings Matrix

| ID | Category | Sev | Impact | Location | Evidence | Confidence |
|---|---|---|---|---|---|---|
| F1 | Bug/Safety | High | Quit-confirm when server running is skipped; the documented `x` KILL key is completely dead (only palette/quit can stop the managed server). | `app.tsx:136,188-218`; `main.tsx` (no `serverRunning`); `quit-state.ts:48,66` | `handleKillKey(…, serverRunning=false)` → action `"none"` → no-op. Footer doesn't even list `[x]`. | Confirmed |
| F2 | Bug | High | Telemetry never reports data if the user launches on a port/host other than the initial 127.0.0.1:8080. | `main.tsx:224-239` | `telemetryService` created once from initial empty config endpoint; never re-pointed when config changes. | Confirmed |
| F3 | Bug/UX | High | Presets tab is view-only in the TUI: "Load into Configurator" (`l`) and launch-from-preset are unwired; only CLI `start` works. | `presets.tsx:51`; `main.tsx:336-342` (no `onLoad`) | `onLoad` prop optional, never passed → `l` no-op. | Confirmed |
| F4 | Bug/UX | High | Theme switching unreachable. Palette "Switch Theme" → `paletteControl?.switchTheme` never provided; persisted `theme` never restored. | `app.tsx:170`; `main.tsx` (no `paletteControl`); `themes/index.ts` (has `themeByName`, unused) | 5 themes defined but only `TOKYO_NIGHT` ever renders. | Confirmed |
| F5 | Arch/UX | High | "[5] Catalog" tab is a Phase-2 widget showcase: fake processes, OpenTUI marketing banner, ASCII art — shipped as a user-facing tab; inflates spec's 4 tabs to 5. | `app.tsx:55-61,278-300`; `catalog.tsx` | `DEMO_ROWS`, `BANNER` are dev artifacts; `TAB_COUNT=5`. | Confirmed |
| F6 | Bug/UX | Med | `binary_not_found`/`port_in_use` details from supervisor are dropped before user-facing classification → generic "exited with code 1". | `session.ts:99-111`; `supervisor.ts:118,127` | `classifyFailure(event.exitCode ?? 1, null, tail)` ignores `event.detail`. | Confirmed |
| F7 | UX/Arch | Med | Configurator is a hand-picked subset of the registry; `batch_size`,`ubatch_size`,`threads`,`chat_template` never exposed though valid. Spec says registry drives the form (§3.3). | `configurator.tsx:113-186`; `registry.ts` | Hardcoded field list; registry has 16 flags. | Confirmed |
| F7b | UX | Med | `--slots`/`--metrics` toggles absent from Configurator; telemetry can't be disabled in UI; `t` toggle + palette "toggle-telemetry" are no-ops. | `configurator.tsx`; `telemetry.tsx:38`; `main.tsx` (no `onEnableTelemetry`) | `telemetryEnabled` hardwired `true`. | Confirmed |
| F8 | UX | Med | Orphan "adopt" (§6.3) never implemented in TUI; `k` kills orphan with no confirmation (inconsistent with app's own confirm patterns). | `app.tsx:219-222`; palette `adoptOrphan` no-op | `paletteControl?.adoptOrphan` undefined. | Confirmed |
| F9 | UX/Persistence | Med | `lastSession` (preset+tab) and `theme` are written but never restored on boot. | `main.tsx:107-117`; `presets-state.ts:60-66` | App always starts tab 0, `TOKYO_NIGHT`. | Confirmed |
| F10 | Config/UX | Med | `default_model_dir` (presets.json) and `binary_path` (schema) are dead; scanner reads only `config.json` `modelsDir`; no UI/CLI to set binary path. | `service.ts:59`; `store/config.ts`; `presets.ts:31,33` | First-run seeds only via `s` key. | Confirmed |
| F11 | UX | Med | Configurator "[Enter] Save & Launch" mislabels behavior — Enter does not persist a preset (that's Ctrl+S). | `configurator.tsx:198` | Mixed mental model. | Confirmed |
| F12 | UX | Med | Telemetry VM never gets VRAM estimate (`vramEstimatedBytes: null`) → "estimate vs actual" comparison can't render. | `main.tsx:322` | Gauge stuck at "no VRAM data". | Confirmed |
| F13 | UX | Med | No inline affordance on Configurator when no model selected; Enter → log-only "no launch configuration". | `configurator.tsx:216`; `session.ts:157` | Hidden cross-tab dependency. | Confirmed |
| F14 | Polish | Low | Branding/version inconsistency: title "v0.1.0 — llamacpp Manager" vs package `llama-deck`; Catalog shows OpenTUI banner. | `app.tsx:321`; `catalog.tsx:4-11` | Product identity unclear. | Confirmed |
| F15 | UX | Low | Keybindings undiscoverable/inconsistent: `x`,`k`,`o`,`r`,`t`,`y` are tab-conditional and absent from footer hint. | `app.tsx:419-424` | Footer lists only Tab/1-5/Enter/o/Ctrl+L/q. | Confirmed |
| F16 | Maint | Low | `DRAWER_HEIGHT = 6` duplicated in `main.tsx:43` and `app.tsx:63` (and again inside `App`). | both files | Should be shared constant. | Confirmed |
| F17 | Maint | Low | `setDefault(file, id, 3)` magic tab index `3`. | `presets-state.ts:60`; `main.tsx:341` | Undocumented; only coincidentally correct. | Confirmed |
| F18 | UX | Low | No blocking "binary not on PATH" onboarding (spec §7); only a boot log warning. | `session.ts:204-208` | Compounds F6. | Confirmed |
| F19 | UX | Low | Inconsistent empty states: configured empty dir shows no "no .gguf found" message; Telemetry pre-server shows bare IDLE with endpoint "-". | `explorer.tsx`; `telemetry.tsx` | Weak guidance. | Confirmed |

---

## D. Ideal User Experience (after fixes)

1. **First launch** → if no `modelsDir`, show an inline directory prompt (editable) that persists; optionally seed from `default_model_dir`.
2. **Setup** → WELCOME explains the 3 steps (set dir → pick model → configure → launch) and the key legend.
3. **First launch task** → pick model in Explorer; Configurator auto-populates with sensible defaults (ngl = full offload, ctx clamped to model max, telemetry on); Enter launches; Telemetry shows live READY/metrics.
4. **Normal use** → changing port/host in Configurator updates the telemetry target; Telemetry populates correctly.
5. **Empty states** → "no models in dir", "no server running — launch one", "telemetry off — press t".
6. **Errors** → structured, actionable messages (binary not found / port in use / OOM with fix), surfaced both in Telemetry FAILED pane and the log.
7. **Recovery** → orphan offers Adopt **or** Kill, both with clear affordance.
8. **Config changes** → theme/preset/tab restored on restart; Presets tab can load a preset into the Configurator and launch it.
9. **Restart/update** → teardown guaranteed; lastSession restored; no orphaned VRAM.

---

## E. Prioritized Backlog

### Phase 1 — Correctness & Blocking (must fix before release)
- **F1** Wire `serverRunning` from `procState` into `<App serverRunning=…>`. *Why:* safety + `x` kill is dead. *Files:* `main.tsx`, `app.tsx`. *Effort:* S. *Impact:* High.
- **F2** Re-point telemetry pollers when launch plan's host/port change (recreate or expose a `setEndpoint` on the service). *Why:* Telemetry silently broken for non-default ports. *Files:* `main.tsx`, `telemetry/service.ts`. *Effort:* M.
- **F3** Wire `onLoad` in `presetsControl` → load preset flags+model into Configurator; add a launch action. *Why:* Presets tab is currently decorative. *Files:* `main.tsx`, `presets.tsx`, `configurator-state`. *Effort:* M.
- **F6** Pass supervisor `detail`/`signal` into `classifyFailure` (add `binary_not_found`/`port_in_use` kinds). *Why:* actionable errors. *Files:* `session.ts`, `failure-classifier.ts`. *Effort:* S.
- **F4** Provide `paletteControl` with `switchTheme` (apply + persist `theme`) and `adoptOrphan`. *Why:* advertised themes/orphan-adopt unreachable. *Files:* `main.tsx`, `app.tsx`. *Effort:* S–M.

### Phase 2 — Core UX
- **F5** Remove the Catalog tab from production (gate behind `LLAMA_DECK_DEBUG` or delete). *Why:* confuses users, dev artifact. *Files:* `app.tsx`, `catalog.tsx`, `shell-state.ts`. *Effort:* S.
- **F9** Restore `lastSession` preset+tab and `theme` on boot. *Why:* persistence is half-done. *Files:* `main.tsx`. *Effort:* M.
- **F8** Implement orphan "adopt" (attach telemetry/logs) or remove the dead palette action; add confirm to `k` kill. *Files:* `session.ts`, `app.tsx`. *Effort:* M.
- **F13/F11** Inline "select a model first" state on Configurator; relabel Enter as "Launch". *Files:* `configurator.tsx`. *Effort:* S.
- **F15** Single help/legend surface (e.g., `?` overlay) listing all bindings; include `[x] Kill`. *Files:* `app.tsx`, new help component. *Effort:* M.

### Phase 3 — Production Hardening
- **F7/F7b** Make Configurator registry-driven (render all flags, with `slots`/`metrics` toggles + telemetry disable). *Files:* `configurator.tsx`, `registry.ts`. *Effort:* M.
- **F10** Use `default_model_dir` to seed first-run; add `binary_path` setting (UI or `llama-deck config`). *Files:* `service.ts`, `store`, CLI. *Effort:* M.
- **F12** Pass VRAM estimate into Telemetry VM for actual-vs-estimated. *Files:* `main.tsx`, `telemetry-state.ts`. *Effort:* S.
- **F18/F19** Blocking binary-not-found onboarding; better empty-dir message. *Files:* `session.ts`, `explorer.tsx`. *Effort:* S–M.

### Phase 4 — Polish
- **F14** Unify branding/version (decide "llama-deck" vX; drop OpenTUI banner). *Effort:* S.
- **F16/F17** Shared `DRAWER_HEIGHT` constant; replace magic `3` with a named tab constant. *Effort:* S.

---

## F. Top 10 Improvements (highest improvement-to-effort)

1. **F1** — pass `serverRunning` (S, restores safety + `x` kill).
2. **F4** — wire `paletteControl.switchTheme` (S, unlocks 5 themes).
3. **F3** — wire Presets `onLoad` (M, makes Presets usable).
4. **F5** — remove Catalog tab (S, removes confusion).
5. **F2** — re-point telemetry endpoint (M, Telemetry works for any port).
6. **F6** — surface `binary_not_found`/`port_in_use` (S, real errors).
7. **F9** — restore lastSession/theme (M, persistence feels real).
8. **F15** — help/legend overlay (M, discoverability).
9. **F13/F11** — Configurator empty-state + relabel (S, fewer dead-ends).
10. **F8** — orphan adopt or drop dead action + confirm `k` (M, recovery coherence).

---

## G. Production-Readiness Verdict

**Already solid:** headless core architecture (D5), atomic JSON persistence + migrations, supervisor teardown
(SIGINT→5s→SIGKILL), orphan pidfile, GGUF parser, GQA-aware VRAM estimator, metadata cache, degraded
<100×30 layout, comprehensive tests (currently RED — 8–10 failing, golden-frame drift + VRAM formula) + golden snapshots +
import-lint. This is a credible foundation.

**Preventing production readiness (must fix):** F1, F2, F3, F4, F6 — all are wiring gaps where implemented
features are disconnected or a safety signal is dropped. Together they make the app feel broken on first
real use.

**Can wait until after release:** F7/F7b (registry-driven form), F10 (binary_path UI), F12 (VRAM compare),
F14/F16/F17 (branding/constants).

**Should be removed/simplified rather than improved:** **F5 (Catalog tab)** — it is a development artifact,
not a product feature; shipping it undermines perceived polish more than any single missing feature. Also
retire the dead palette actions (adopt-orphan/toggle-telemetry) if not implemented, rather than leaving them
as no-ops (F8/F4).

**Doc-vs-implementation discrepancy to flag:** the spec (`plans/llamamanager.md`) defines **4 tabs**; the
implementation ships **5** (Catalog added). Also spec §2.3 lists `--slots`/`--metrics` as Configurator
toggles and §6.3 an "adopt" recovery — none are wired in the TUI. `docs/phase5-report.md` was not read in
full, but given F3/F4/F8, its "done" claims should be re-verified against actual handler wiring before being
trusted.

---

## H. Phase Status Review & Archive Decision (2026-08-28)

**Context:** the spec (`plans/llamamanager.md` §9) only defines original **Phases 1–5**. Phases 6–14 are the
remediation roadmap in `plans/audit-remediation-roadmap.md` (also dated 2026-08-28). The user's "we are on
phase 11" refers to **remediation** Phase 11 (model-discovery), not the original spec. Git shows remediation
Phases 6–11 merged, but their EXIT criteria are **not green from `main`**.

### Done vs. not-done (phases 1–11)

| Phase (doc) | Reality | Status |
|---|---|---|
| P1 walking-skeleton (`prd-phase-1`) | teardown/orphan guarantee holds | ✅ done → **archived** |
| P2 widget-library (`prd-phase-2`) | widgets + catalog mockup exist (catalog wart → P14) | ✅ done → **archived** |
| P3 gguf-discovery (`prd-phase-3`) | parser solid, but VRAM formula test (P3-FR-12) + explorer goldens FAIL | ⛔ suite red |
| P4 configurator (`prd-phase-4`) | build/save/launch/export work, but configurator goldens FAIL; F7 registry-driven gap | ⛔ suite red |
| P5 telemetry/errors (`prd-phase-5`) | NOT done in TUI: F2 endpoint, F4/F8 palette, F6/F18 binary surfacing; telemetry goldens FAIL | ⛔ open gaps |
| P6 lifecycle-safety (`phase-6`) | teardown restartable/idempotent, no failures | ✅ done (blocked by red suite) |
| P7 real-telemetry (`phase-7`) | NOT done: F2 endpoint, F1 `serverRunning` never passed to `App`, F6 toggle no-op | ⛔ open gaps |
| P8 config/preset/binary (`phase-8`) | NOT done: F3 presets `onLoad` unwired, F10 `binary_path`/`default_model_dir` dead, F11 mislabel | ⛔ open gaps |
| P9 persistence (`phase-9`) | atomic writes, pidfile ownership solid | ✅ done (blocked by red suite) |
| P10 portability (`phase-10`) | orphan detect works; adopt not wired in TUI (F8 → P13) | ⛔ open gap |
| P11 model-discovery (`phase-11`) | scanner hardening solid; F19 minor empty-state → P14 | ✅ done (blocked by red suite) |

### Two blockers to archiving the rest
1. **Red suite** — `bun test` is 8–10 failing (flaky), all in P3/P4/P5 golden frames + the VRAM formula test.
   Repo archive policy (`audit-remediation-roadmap.md`) forbids archiving until EXIT is green from `main`.
2. **Open wiring gaps** — P5/P7/P8/P10 never closed their EXIT (telemetry/configurator/palette/presets are
   partially broken in the running app). These are owned by remediation P13 (keyboard/UI) and P8/P14.

### Outcome
- **Archived** (`plans/archive/`): `prd-phase-1-walking-skeleton.md`, `prd-phase-2-widget-library.md`.
- **Kept** (blocked by red suite and/or open wiring gaps): `prd-phase-3`, `prd-phase-4`, `prd-phase-5`,
  `phase-6`, `phase-7`, `phase-8`, `phase-9`, `phase-10`, `phase-11` — plus future `phase-12/13/14`,
  `llamamanager.md` (spec), `audit-remediation-roadmap.md`, this audit, and `docs/`.
- When the suite is green and P5/P7/P8/P10 wiring gaps close, the clean archive set is
  `prd-phase-3/4`, `phase-6/9/11` (keep `prd-phase-5`, `phase-7/8/10` until their EXIT passes).

> Note: this audit overlaps with `audit-remediation-roadmap.md` (which already enumerates P6–P14); the audit
> adds the concrete UI-wiring breakages (F1–F19).
