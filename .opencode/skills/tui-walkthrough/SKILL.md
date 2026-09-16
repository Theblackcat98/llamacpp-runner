---
name: tui-walkthrough
description: "Use when driving or auditing any TUI app as a user via tmux."
---

# TUI Walkthrough — drive terminal apps like a user

tmux gives the same superpowers over a TUI that browser automation gives over a
web app: launch isolated, drive keystrokes, screenshot (capture-pane) the
*rendered* screen, and assert on what the user actually sees. Rendered frames are
the only acceptable proof — an exit code 0 or a passing unit test is not
"the screen tells the user the truth".

## When to use

* UX audit / user-flow walkthrough of any interactive terminal app (ncurses,
  bubbletea, OpenTUI, ink, ratatui…)
* Reproducing a reported bug that "only happens interactively"
* Verifying a TUI fix visually after code changes (screenshots, not 200s)
* Driving a TUI through a scripted scenario when the app has no test harness

## Session setup

```bash
# fixed geometry, detached, isolated state — never touch real user config
mkdir -p .tmp/xdg-config .tmp/xdg-state .tmp/fixtures
tmux new-session -d -s APPNAME -x 120 -y 40 \
  "env XDG_CONFIG_HOME=$PWD/.tmp/xdg-config XDG_STATE_HOME=$PWD/.tmp/xdg-state \
   PATH=$PATH <launch command> 2>.tmp/tui-stderr.log"
```

* `-x/-y` set a deterministic viewport; also spot-check a second size (e.g. 80x24,
  200x60) for layout breakage.
* Redirect stderr to a log — crashes and debug output land there, not the frame.
* PATH must be passed explicitly; the tmux server may not inherit the agent shell.
* Check the app's config-resolution (XDG_*, HOME, --config flags) and isolate ALL
  write paths. Never run against the real HOME.
* Reuse `tmux kill-session -t APPNAME` between scenarios; stale sessions bite.

## Fixtures

Synthetic beats real for flow-testing: tiny files that exercise the app's real
parsers (e.g. header-only GGUFs, 1-row CSVs, empty DB schemas) so scans/parses run
for real without heavyweight assets. If the repo has fixture builders in tests/,
use them from a .tmp script. Persist nothing outside .tmp (repo convention: .tmp/
not /tmp).

## Driving

```bash
tmux send-keys -t APPNAME '2'          # tab key / hotkey
tmux send-keys -t APPNAME 'm'          # open dialog
tmux send-keys -t APPNAME "path text"  # type into a field
tmux send-keys -t APPNAME Enter        # submit
tmux send-keys -t APPNAME Escape      # cancel
```

* Plain `send-keys 'text'` sends keystrokes — shell-expanded vars in double
  quotes arrive expanded (useful for paths).
* Use `send-keys -l` when the text must be LITERAL (contains key-like words:
  Enter, Escape, Space, or leading dashes).
* TUIs render async: sleep 0.5–2s after actions. For assertions, poll capture
  output in a bounded loop (up to ~5s) instead of one fixed sleep.

## Reading the screen

```bash
tmux capture-pane -t APPNAME -p            # full frame as text
tmux capture-pane -t APPNAME -p | grep -v '^$' | sed -n '5,14p'   # a region
```

* Filter blank lines, then sed a line range to focus a region (header, table,
  status bar). Line numbers are stable for a fixed geometry.
* Assert on exact visible strings ("No model directory configured"), not vibes.
* tmux capture-pane IS the screenshot; attach the captured frame to findings.

## The UX-audit checklist (what caught real bugs in llama-deck 2026-09)

For each screen and each advertised binding:

1. **Truth**: does the screen state match reality? ("no models found" while a
   scan succeeded = lie; "dir not set" while config holds one = lie.)
2. **Discoverability**: open the help/legend overlay and diff advertised keys
   vs keys the code actually handles. Undocumented binding = missing feature.
3. **Edge inputs**: capitals, spaces, `~`, empty input, Enter-to-confirm leaking
   into the next handler, Esc behavior. (OpenTUI/bubbletea key parsers often
   lowercase shifted keys — test `AbC-XyZ` in EVERY text field.)
4. **Error surfacing**: point the app at a bad path/missing file. Bad-input state
   must be visibly distinct from valid-empty state.
5. **Cross-screen drift**: select something on tab 1, rescan/refresh, check tab 2
   still agrees (selection, model, status).
6. **Z-order**: overlays (help, palettes, dialogs) must fully occlude what's
   beneath; look for border bleed-through at edges.
7. **Persistence honesty**: after actions, cat the app's config/state files in
   .tmp — is what it stored what the user thinks they entered?

## Debugging tricks when the flow breaks

* **Headless vs TUI isolation**: extract the suspect module and run it in a
  .tmp script under the SAME env vars. Works headless but not in the TUI →
  composition/wiring bug (state emitted before subscribers attach, missing
  re-emit, dropped error fields). Works nowhere → module bug.
* **Instrument + revert**: temporarily patch debug `process.stderr.write(...)`
  lines into wiring code, keep `cp file .tmp/file.bak`, restore after. stderr
  is already teed to .tmp/tui-stderr.log by session setup.
* **Third-source evidence**: the app's persisted files (config.json, caches)
  prove what the internals believe, independent of the rendered frame.
* Zero instrumentation survives the session: `git status` must be clean at the
  end; diffs only ever live in .tmp.

## Reporting

* File each finding with: steps to reproduce (exact send-keys sequence), the
  captured frame, root-cause file:line if found, and a suggested acceptance test.
* Sequence findings by user impact: what blocks a first-run user > what annoys
  > cosmetic.
* Name the meta-finding too: if every bug lives in one seam (e.g. composition
  root has no E2E test), that's its own issue.

## Pitfalls

* Key names are case-sensitive to the app, and `send-keys 'q'` ≠ typed q if the
  app reads shift/ctrl metadata — test modifier combos explicitly.
* capture-pane shows the *visible* viewport; scrolled-off lines need
  `-S -N` history flags.
* Long sleeps hide races; poll instead. Short sleeps miss renders; poll instead.
* If the app daemonizes or spawns children, kill-session may orphan them —
  pgrep for the app binary before declaring cleanup done.
* macOS: tmux -x/-y needs a client attach first or dimensions may not apply
  (`tmux resize-window -t s -x 120 -y 40` after creation as a fallback).
