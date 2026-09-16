# llama-deck

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> A modern, keyboard-first terminal control deck and manager for [`llama.cpp`](https://github.com/ggerganov/llama.cpp) (`llama-server`).

`llama-deck` combines headless model inspection, live configuration, telemetry monitoring, and process supervision into an elegant TUI and CLI.

---

## Features

- **GGUF Model Explorer**: Deep inspection of GGUF metadata, architecture, tensor info, quantization types, and split files with dynamic directory watching.
- **Availability-Aware Configurator**: Live command construction with interactive form controls, dynamic `--help` availability validation against your active `llama-server` binary, and VRAM estimation.
- **Zero-Orphan Process Supervisor**: Reliable lifecycle management running under strict process group teardown (SIGINT → 5s grace → SIGKILL escalation) with PID reuse protection.
- **Live Telemetry & Diagnostics**: Real-time Prometheus metrics scraping (`tokens/sec`, prompt/decode speeds, KV cache utilization, memory usage) and slot activity sparklines.
- **Fail-Safe Persistence**: Atomic JSON storage (same-directory temporary file + fsync + rename) for presets and session state with forward-only schema migrations.
- **Terminal Portability & Truecolor**: Full OSC 52 clipboard yanking, 1-column braille spinners, box borders, responsive degraded layouts for compact terminals (<100x30), and 7 themes (TokyoNight, Catppuccin, Gruvbox, Cyberpunk, RosePine, Nord, Everforest).
- **Dual Interface**: Full interactive TUI alongside a fast headless CLI (`scan`, `list`, `presets`, `export`, `start`, `kill`) with optional `--json` output.

---

## Prerequisites

- **Runtime**: [Bun](https://bun.sh) (v1.3+ or v1.4+)
- **Server**: `llama-server` binary on `$PATH` or specified via `binary_path` configuration
- **Operating System**: Linux (full `/proc` process inspection and signal tracking), macOS / POSIX supported

---

## Installation & Setup

```bash
# Clone the repository
git clone https://github.com/Theblackcat98/llamacpp-runner.git
cd llamacpp-runner

# Install dependencies
bun install
```

> **Repo name note**: the GitHub repository slug is `llamacpp-runner` (historical);
> the product, package, CLI, and TUI are all **llama-deck**. The clone directory
> will be named `llamacpp-runner` — that is expected. `package.json` ("name":
> "llama-deck") is the canonical product identity.

---

## Usage

### Interactive TUI

Launch the interactive terminal deck:

```bash
bun run dev
```

#### Keybindings

| Key | Scope | Action |
|---|---|---|
| `1` | Global | Switch to **Models** tab |
| `2` | Global | Switch to **Configure** tab |
| `3` | Global | Switch to **Presets** tab |
| `4` | Global | Switch to **Telemetry** tab |
| `?` | Global | Toggle **Help Overlay** |
| `Ctrl+P` | Global | Open **Command Palette** |
| `Ctrl+C` | Global | Clean quit (confirms if server running; double-press force quits) |
| `x` | Global | Kill running server instance (with confirmation prompt) |
| `j` / `k` or `↓` / `↑` | Lists | Navigate rows / options |
| `Enter` | Models | Select model for configuration |
| `Enter` | Configure | Launch configured `llama-server` instance |
| `Ctrl+S` | Configure | Save current configuration as a Preset |
| `y` | Configure | Yank command line to system clipboard (via OSC 52 / xclip / xsel) |
| `t` | Configure | Toggle telemetry scrape flags (`--slots`, `--metrics`) |
| `r` | Models | Trigger manual rescan of models directory |
| `l` | Presets | Load selected preset into Configurator |
| `d` | Presets | Delete selected preset |

---

### Headless CLI

`llama-deck` includes a dedicated CLI for automation and shell scripting:

```bash
# 10-second path: parse metadata, auto-fit GPU VRAM, and generate optimal launch command
bun run cli quick /path/to/model.gguf

# Run immediately under zero-orphan supervisor (§6.2 teardown)
bun run cli quick /path/to/model.gguf --run

# Emit launch plan and VRAM estimate as JSON
bun run cli quick /path/to/model.gguf --json

# Scan a directory for GGUF models
bun run cli scan /path/to/models [--json]

# List recognized model names
bun run cli list /path/to/models [--json]

# List saved presets
bun run cli presets [--json]

# Export preset launch command (formats: cmd | sh | systemd)
bun run cli export <preset-id> --format sh
bun run cli export <preset-id> --format systemd

# Launch a preset in foreground
bun run cli start <preset-id>

# Stop a running managed server via pidfile teardown
bun run cli kill [--json]
```

---

## Architecture & Design Principles

The codebase is strictly structured into three decoupled layers:

```
src/
├── core/         # Headless domain logic (no UI or React dependencies)
│   ├── bus.ts            # Typed event bus (intents down, state up)
│   ├── estimate/         # Monotonic VRAM calculation & memory bounds
│   ├── flags/            # Registry, availability gating, CLI quote & builder
│   ├── models/           # GGUF parser, split file grouping, scanner & watcher
│   ├── process/          # Supervisor, transport, process identity & orphans
│   ├── store/            # Atomic JSON persistence & XDG state paths
│   └── telemetry/        # Prometheus parser, health, metrics, & slots pollers
├── ui/           # React terminal UI layer (@opentui/react)
│   ├── components/       # Forms, tables, sparklines, gauges, dialogs
│   ├── logic/            # Pure state machines for views & key handling
│   ├── screens/          # Models, Configure, Presets, Telemetry viewports
│   └── themes/           # TokyoNight, Catppuccin, Gruvbox, Cyberpunk, RosePine, Nord, Everforest
├── cli.ts        # Fast standalone CLI entrypoint (<20ms startup)
└── main.tsx      # TUI composition root & bus wiring
```

### Safety Guarantees

1. **Layer Separation**: `src/core` never imports from `src/ui` (enforced by import lint).
2. **Single Instance**: Exactly one managed `llama-server` instance at a time (D4).
3. **Idempotent Teardown**: All process spawn paths terminate through a unified graceful SIGINT → wait ≤ 5s → SIGKILL escalation (§6.2).
4. **Data Durability**: Configuration lives under `$XDG_CONFIG_HOME/llama-deck/`, runtime state under `$XDG_STATE_HOME/llama-deck/`. Writes use temporary file fsync + atomic rename.
5. **Memory Boundedness**: Ring buffers and sparkline history rings cap capacity (120 samples default), preventing unbounded memory growth during long-running sessions.

---

## Verification & Testing

The project maintains an exhaustive test suite covering headless domain logic, process lifecycle, UI state machines, golden-frame visual regressions, and automated release gates:

```bash
# Run full unit and integration test suite (490 tests across 93 files)
bun test

# Run code style & linting checks (Biome)
bun run lint

# Run TypeScript typecheck
bun run typecheck
```

---

## License

MIT — see [LICENSE](LICENSE).
