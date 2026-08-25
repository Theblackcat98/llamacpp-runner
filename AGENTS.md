# AGENTS.md

Development rules for llama-deck. Spec of record: `plans/llamamanager.md` — `§` references point there. Read the relevant spec section before touching a component; if the spec is silent, propose in the branch description instead of inventing scope.

## Stack facts

- Runtime: Bun, version-pinned. Never assume Node.js-specific APIs without checking Bun compatibility.
- Layers: `src/core` (headless domain logic) · `src/ui` (@opentui/react shell) · `src/cli.ts`.
- Roadmap: §9 defines phases; each phase ends with an EXIT criterion; each bullet inside a phase is a branch-sized WORK ITEM.
- Scratch work: never use `/tmp/*`. Create a `.tmp/` folder inside the project instead (gitignored).

## User preferences

- Scratch/temp files go in the project's `.tmp/` folder, never `/tmp/*`.

## Hard rules (violations fail CI, not review)

1. `src/core` MUST NOT import from `src/ui` or any UI package (D5). Enforced by import-lint.
2. Cross-layer traffic only via the typed event bus — intents down, state up.
3. Persistence is JSON with atomic writes (temp + rename) and forward-only migrations (D1, §5). Config lives under `$XDG_CONFIG_HOME/llama-deck/`, runtime state under `$XDG_STATE_HOME/llama-deck/` — never mixed.
4. Every process-spawn path terminates through the shared idempotent teardown (§6.2): SIGINT → wait ≤5 s → SIGKILL. Do not bypass it or register ad-hoc exit handlers.
5. PTY default, pipe fallback (D3). Clipboard via OSC 52 first (D6). Braille/ASCII spinners only — no emoji glyphs (D8).
6. Exactly one managed llama-server instance in v1 (D4).

## The loop

One WORK ITEM (§9 bullet) → one branch → one merge.

1. **Branch**: cut `phase<N>/<slug>` from latest `main` (e.g. `phase3/gguf-parser`). Exploration goes on `spike/<slug>` branches — timeboxed, throwaway, never merged.
2. **Isolate layers**: core and UI changes never share a branch. CLI additions may ride with the core feature that enables them.
3. **Test first**: write the failing test before implementation — unit tests for pure logic (`src/core`), integration tests for process/IO (supervisor vs `tests/fixtures/fake-server.sh`, telemetry vs mock HTTP). Fixtures commit together with the test that consumes them.
4. **Commit per green cycle**: one logical change after each red→green→refactor pass. Format: `scope: behavior (§ref)` — e.g. `supervisor: SIGINT → wait ≤5 s → SIGKILL (§6.2)`. No "wip" commits survive to merge.
5. **Verify before every commit**: lint + typecheck + targeted tests.
6. **Verify before merge**: full suite + integration green; golden-frame snapshots updated when UI changed; zero skipped/pending tests introduced. Branches touching `src/core/supervisor` MUST run the teardown/orphan suite — mandatory, every time.
7. **Merge** with `--no-ff` into `main`; delete the branch. `main` stays green at all times — if broken, repairing it outranks all other work.

## Phase gates

- Opening a branch for phase N+1 while phase N's EXIT criterion is unmet is a defect — finish or explicitly descope first.
- A phase is complete ONLY when its EXIT criterion passes end-to-end from `main`. Tag the boundary `v0.<N>.0`, then start the next phase.
- Manual verification happens per phase exit, not per commit: terminal compat checklist (§8) — tmux, kitty, ghostty, wezterm, alacritty, VSCode terminal — braille width, box glyphs, OSC 52, truecolor.

## Commands (finalize during Phase 1 scaffold; keep this list true)

- `bun install` — setup
- `bun test` — unit + integration
- `bun run lint && bun run typecheck`
- `bun run dev` — TUI against a scratch config/state home

Never leave a documented command broken; fix code or docs in the same change.
