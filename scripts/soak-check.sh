#!/usr/bin/env bash
# Phase 5 soak-check helper (PRD §10): run llama-deck against a real
# llama-server with active telemetry, then assert no orphan and sane state.
#
# Usage: scripts/soak-check.sh [duration_minutes]
# Requires a real llama-server binary on PATH (or LLAMA_SERVER env) and a
# preset id to launch. This script drives the CLI; the TUI soak is manual.
set -euo pipefail

MINUTES="${1:-60}"
PRESET="${LLAMA_DECK_PRESET:-}"
SERVER_BIN="${LLAMA_SERVER:-llama-server}"

if [ -z "$PRESET" ]; then
	echo "error: set LLAMA_DECK_PRESET=<preset-id> to soak" >&2
	exit 2
fi

if ! command -v "$SERVER_BIN" >/dev/null 2>&1 && [ ! -x "$SERVER_BIN" ]; then
	echo "error: $SERVER_BIN not found — set LLAMA_SERVER=/path/to/llama-server" >&2
	exit 2
fi

echo "[soak] starting ${MINUTES}m session with preset '$PRESET'"
bun run src/cli.ts start "$PRESET" &
CLI_PID=$!

# Sample telemetry + VRAM ground truth every 30 s while the server runs.
(
	while kill -0 "$CLI_PID" 2>/dev/null; do
		TS=$(date +%H:%M:%S)
		if command -v nvidia-smi >/dev/null 2>&1; then
			VRAM=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits | head -1)
			echo "[soak $TS] vram_used=${VRAM}MiB"
		fi
		sleep 30
	done
) &
SAMPLER=$!

cleanup() {
	echo "[soak] tearing down"
	kill "$SAMPLER" 2>/dev/null || true
	bun run src/cli.ts kill --json || true
	wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

wait "$CLI_PID"

echo "[soak] checking for orphans..."
if pgrep -f "llama-server" >/dev/null 2>&1; then
	echo "[soak] FAIL: orphaned llama-server process(es) remain:" >&2
	pgrep -af llama-server >&2
	exit 1
fi

echo "[soak] OK: clean teardown after ${MINUTES}m target (or earlier exit)"
echo "[soak] manual review: compare sampled VRAM vs /metrics llamacpp:memory_used_bytes;"
echo "[soak] confirm steady-state RSS of this script's bun processes showed no unbounded growth."
