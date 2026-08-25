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
| tmux             | ☐       | ☐   | ☐         | ☐     | ☐¹     | ☐         | ☐        | ¹ needs `set -g set-clipboard on` (or tmux ≥3.2 + outer support) |
| kitty            | ☐       | ☐   | ☐         | ☐     | ☐      | ☐         | ☐        | OSC 52 native |
| ghostty          | ☐       | ☐   | ☐         | ☐     | ☐      | ☐         | ☐        | OSC 52 native |
| wezterm          | ☐       | ☐   | ☐         | ☐     | ☐²     | ☐         | ☐        | ² set `clipboard = "OSC52"` in config when remote |
| alacritty        | ☐       | ☐   | ☐         | ☐     | ☐³     | ☐         | ☐        | ³ requires `osc52` allowed via config |
| VSCode terminal  | ☐       | ☐   | ☐         | ☐     | ☐      | ☐         | ☐        | truecolor on by default since VS Code 1.60 |

## Procedure

1. `bun run dev` inside the target terminal.
2. Walk tabs [1]–[5]; confirm braille spinner, box borders, sparkline/gauge
   glyph alignment (checklist rows 1–4).
3. Press `y` on the configurator; verify clipboard receives the command
   (locally, and over SSH for OSC 52 verification).
4. Confirm theme colors match the design lab tokens (truecolor).
5. Shrink below 100x30; confirm degraded hint renders without overlap.
6. Record pass/fail per cell above.

## Sign-off

| Terminal | Checked by | Date | Result |
|----------|------------|------|--------|
| tmux     | _pending manual pass_ | | |
| kitty    | _pending manual pass_ | | |
| ghostty  | _pending manual pass_ | | |
| wezterm  | _pending manual pass_ | | |
| alacritty| _pending manual pass_ | | |
| VSCode   | _pending manual pass_ | | |

> EXIT criterion requires all six signed off before tagging v1.0.0.
