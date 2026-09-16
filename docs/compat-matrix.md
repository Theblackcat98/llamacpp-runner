# Terminal Compatibility Matrix — llama-deck

Checklist per spec §8. Verification status as of package version **0.1.0**
(phase boundary tag `v0.5.0` = Phase 5 EXIT). There is **no v1.0.0 sign-off**:
the automated portion of this matrix is green, but a §8 sign-off requires the
manual per-terminal runs tracked below. This file is part of the Phase 5 EXIT
evidence; a terminal row ships only when every check passes manually or has a
recorded workaround.

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

## Automated coverage

`tests/automated-manual/terminal-compat.test.ts` verifies, without spawning a
real terminal:

1. Braille spinner glyphs (`⠋⠙⠹`) measure exactly 1 column width (no table drift).
2. Single/double box glyphs and border corners measure 1 column width.
3. Sparkline blocks (`▁▂▃▅▇`) measure 1 column width each.
4. Gauge bar fills (`█░`) measure 1 column width each.
5. OSC 52 sequence formatting and base64 round-trip, with fallback handling.
6. 24-bit truecolor hex definitions exist for all 5 themes: **TokyoNight,
   Catppuccin, Gruvbox, Cyberpunk, Matrix** (`src/ui/themes/index.ts`).
7. Degraded layout threshold is active below 100 columns or 30 rows.

What automation **cannot** cover: real font rendering, actual clipboard
delivery over SSH, terminal-specific config quirks, and truecolor passthrough.
Those are the manual checks below.

## Manual per-terminal status

| Terminal        | braille | box | sparkline | gauge | OSC 52 | truecolor | degraded | Notes |
|-----------------|---------|-----|-----------|-------|--------|-----------|----------|-------|
| tmux            | ☐       | ☐   | ☐         | ☐     | ☐¹     | ☐         | ☐        | ¹ needs `set -g set-clipboard on` (or tmux ≥3.2 + outer support) |
| kitty           | ☐       | ☐   | ☐         | ☐     | ☐      | ☐         | ☐        | OSC 52 native |
| ghostty         | ☐       | ☐   | ☐         | ☐     | ☐      | ☐         | ☐        | OSC 52 native |
| wezterm         | ☐       | ☐   | ☐         | ☐     | ☐²     | ☐         | ☐        | ² set `clipboard = "OSC52"` in config when remote |
| alacritty       | ☐       | ☐   | ☐         | ☐     | ☐³     | ☐         | ☐        | ³ requires `osc52` allowed via config |
| VSCode terminal | ☐       | ☐   | ☐         | ☐     | ☐      | ☐         | ☐        | truecolor on by default since VS Code 1.60 |

`☑` = recorded from a real manual run (with date in the sign-off below);
`☐` = outstanding.

## Sign-off

No manual sign-off recorded yet. When a terminal is verified by hand, add a
row here with checker, date, and result. The Phase 5 EXIT criterion's
"compat checklist signed off" is satisfied only when every row above is
`☑` and this table is complete — or when descope is recorded explicitly.
