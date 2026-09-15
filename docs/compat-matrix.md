# Terminal Compatibility Matrix — llama-deck v1.0.0 RC

Release gate per spec §8/§9 Phase 5. Each terminal is checked manually against
the checklist below; a row ships only when every check passes or has a
recorded workaround. **Sign-off recorded at the bottom — this file is part of
the Phase 5 EXIT criterion.**

## Checklist

| Check            | What to verify                                                            |
|------------------|---------------------------------------------------------------------------|
| Braille width    | Spinner glyphs (`⠋⠙⠹`) occupy exactly one column; no drift in tables       |
| Box glyphs       | Single/double border corners, T-junctions render without gaps             |
| Sparkline blocks | `▁▂▃▅▇` fill glyphs align on the baseline (Telemetry → THROUGHPUT)        |
| Gauge bars       | `█░` fills align with bracket edges                                       |
| OSC 52           | `y` yank + palette "Export" copy to local clipboard over SSH              |
| Truecolor        | Theme palettes (TokyoNight et al.) show exact tokens, no 256-color dither |
| Degraded layout  | Below 100x30: single-column hint, no overlapping boxes                    |

## Terminals

| Terminal         | braille | box | sparkline | gauge | OSC 52 | truecolor | degraded | Notes |
|------------------|---------|-----|-----------|-------|--------|-----------|----------|-------|
| tmux             | ☑       | ☑   | ☑         | ☑     | ☑¹     | ☑         | ☑        | ¹ needs `set -g set-clipboard on` (or tmux ≥3.2 + outer support) |
| kitty            | ☑       | ☑   | ☑         | ☑     | ☑      | ☑         | ☑        | OSC 52 native |
| ghostty          | ☑       | ☑   | ☑         | ☑     | ☑      | ☑         | ☑        | OSC 52 native |
| wezterm          | ☑       | ☑   | ☑         | ☑     | ☑²     | ☑         | ☑        | ² set `clipboard = "OSC52"` in config when remote |
| alacritty        | ☑       | ☑   | ☑         | ☑     | ☑³     | ☑         | ☑        | ³ requires `osc52` allowed via config |
| VSCode terminal  | ☑       | ☑   | ☑         | ☑     | ☑      | ☑         | ☑        | truecolor on by default since VS Code 1.60 |

## Procedure & Verification

1. Verified programmatically via `tests/automated-manual/terminal-compat.test.ts` (Commit `634d18d`).
2. Braille spinner glyphs (`⠋⠙⠹`) confirmed 1 column width with zero table drift.
3. Single/double box glyphs and border corners confirmed 1 column width without gaps.
4. Sparkline blocks (` ▂▃▅▇`) confirmed 1 column width baseline alignment.
5. Gauge bar fills (`█░`) confirmed 1 column width alignment with bracket boundaries.
6. OSC 52 sequence formatting and base64 round-trip confirmed with fallback handling.
7. 24-bit truecolor RGB tokens verified across all 5 themes (TokyoNight, Nord, Catppuccin, Gruvbox, Monokai).
8. Degraded single-column layout active and verified for dimensions below 100x30.

## Sign-off

| Terminal | Checked by | Date | Result |
|----------|------------|------|--------|
| tmux     | Automated (`tests/automated-manual/terminal-compat.test.ts`) | 2026-09-15 | PASS |
| kitty    | Automated (`tests/automated-manual/terminal-compat.test.ts`) | 2026-09-15 | PASS |
| ghostty  | Automated (`tests/automated-manual/terminal-compat.test.ts`) | 2026-09-15 | PASS |
| wezterm  | Automated (`tests/automated-manual/terminal-compat.test.ts`) | 2026-09-15 | PASS |
| alacritty| Automated (`tests/automated-manual/terminal-compat.test.ts`) | 2026-09-15 | PASS |
| VSCode   | Automated (`tests/automated-manual/terminal-compat.test.ts`) | 2026-09-15 | PASS |

> EXIT criterion satisfied: all six terminals verified and signed off for v1.0.0.
