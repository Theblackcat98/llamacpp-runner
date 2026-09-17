# Ideas: GGUF test fixtures without real models · shell command import

Status: proposed (2026-09-15)
Source: owner discussion 2026-09-15 (post re-audit at `0b4959c`)
Related: `tests/fixtures/gguf/`, `src/core/export/quote.ts`, `src/core/flags/registry.ts`

Not yet spec'd work items — each is branch-sized per §9 house loop. Nothing here
changes `plans/llamamanager.md` until an item is picked up; at that point add the
§-level requirement first.

---

## Idea A — GGUF coverage without shipping real models

The repo already has the two right mechanisms; this extends them rather than
adding a third.

**What exists**

- `tests/fixtures/gguf/build.ts` — synthetic GGUF writer: arbitrary metadata
  trees, all scalar/array types, hostile values. Zero network, zero licensing,
  deterministic.
- `tests/fixtures/gguf/capture.ts` — maintainer script that HTTP-range-fetches
  only the header (KBs, never weights) from public HuggingFace models and commits
  `<name>.ggufheader` + expected-value JSON. Current corpus: llama2, qwen2.5,
  gemma3, deepseek2-lite.
- Perf gate: 100 synthetic files < 2 s (`tests/phase3-exit.test.ts`).

**Proposed work items**

1. **Expand the capture corpus** — one `SOURCES` entry + range request each for
   metadata shapes the corpus misses: llama3-class rope_scaling arrays, phi-3,
   command-r, a second MoE family (expert-count metadata beyond deepseek2).
   Committed artifacts stay header-only.
2. **GGUF version canary** — `capture.ts` gains a `--check` mode: re-fetch
   current sources, diff committed JSON vs upstream, report drift. Run manually
   or on a slow cron; never in CI (HF uptime). Catches llama.cpp spec bumps
   (version field, new metadata keys) before users do.
3. **Property-fuzz writer↔parser** — seeded PRNG loop, no framework: random
   metadata trees → `build.ts` writes → parser reads → round-trip equality
   assert, plus truncation at every offset < header length. Generalizes the
   existing hostile fixtures into a property.

**Explicitly rejected:** full-model downloads in CI (bandwidth, flake, licensing),
mocking the parser instead of exercising it (tests would test nothing).

---

## Idea B — shell command import (strict tokenizer, no shell)

`shellQuote()` + the flag builder already emit deterministic POSIX sh
(`src/core/export/quote.ts`). Import is the inverse function, written as a
strict-subset tokenizer — never a shell.

**Scope of accepted input**

Exactly what the exporter emits, plus the two conveniences found in the wild:

- bare words and single-quoted words (incl. the `'\\''` splice)
- `#` comment lines, trailing `\\` continuations, optional leading `$`
- argv from any wrapper (`llama-server …`, `./llama-server …`) — binary token
  is parsed and discarded, not executed

**Hard rejects** (error names the offending token, parse fails whole-input):

`$var`, backticks, `&& ; | > < (`, `env FOO=…` prefixes, double-quoted words.
No `sh -c`, no eval, size-capped input. A tokenizer that refuses ambiguity
cannot be confused by it — that is the entire security story.

**Mapping**

- argv → registry: alias resolution (`-c`/`--ctx-size`) via `registry.ts`,
  value validation via `validate-values.ts`
- unknown flags → "not in registry for this binary" warning, not silent drop
  (availability gating already exists)
- result → preset or live Configurator state

**The round-trip invariant (the actual spec)**

`export .sh → parse → preset → export` must be byte-identical. Golden + property
tests pin it; exporter and importer can never drift apart, same pattern as
preview/spawn argv parity.

**Why it earns its keep**

Primary value is not re-importing our own exports — it is pasting a command
from an HF model card or forum thread into the Configurator: press `i`, paste,
get a configured preset with VRAM estimate. Strict subset covers both cases.

**Placement**

- `src/core/import/shell.ts` — pure, core-only (D5-safe)
- CLI rider: `llama-deck import <file.sh|->` (export already exists in cli.ts)
- UI: import action on Presets tab + Configurator paste entry

**Deferred:** systemd-unit import — different quoting dialect
(`systemdQuote`), same tokenizer shape, do it only if asked for.

**Rejected:** a "lenient" mode that accepts double quotes/env vars — leniency
is where the ambiguity bugs live; keep the strict subset total.
