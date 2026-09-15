---
name: subagent-delegation
description: Guidelines and trigger conditions for delegating tasks to the repository's custom subagents (explore and coder).
---

# Subagent Delegation Guide for `llama-deck`

This repository defines specialized local subagents under [`.agents/agents/`](file:///home/nick/Documents/Projects/llamacpp-runner/.agents/agents/). Consult this skill whenever routing incoming user requests between direct execution and subagent delegation.

---

## Available Repository Subagents

### 1. `explore` ([explore.md](file:///home/nick/Documents/Projects/llamacpp-runner/.agents/agents/explore.md))
- **Profile**: Read-only codebase explorer.
- **Model / Effort**: `flash` (fast, low-latency Gemini Flash).
- **Tool Access**: Read-only (`view_file`, `grep_search`, `find_by_name`, `list_dir`, `read_url_content`). No write or shell tools.
- **When to Delegate**:
  - Investigating architecture, module boundaries, or data flow across `src/core`, `src/ui`, and `src/cli.ts`.
  - Finding where specific functions, interfaces, or event types are defined.
  - Cross-referencing current code against requirements in [plans/llamamanager.md](file:///home/nick/Documents/Projects/llamacpp-runner/plans/llamamanager.md) or constraints in [AGENTS.md](file:///home/nick/Documents/Projects/llamacpp-runner/AGENTS.md).
  - Broad file scouting that would otherwise pollute the primary context window.

---

### 2. `coder` ([coder.md](file:///home/nick/Documents/Projects/llamacpp-runner/.agents/agents/coder.md))
- **Profile**: Dedicated implementation engineer.
- **Model / Effort**: `inherit` with `effort: medium`.
- **Tool Access**: Full write tools (`write_to_file`, `replace_file_content`) and terminal commands (`run_command`).
- **When to Delegate**:
  - Substantial features spanning multiple files.
  - Non-trivial refactors or architecture migrations.
  - Multi-work-item execution: When multiple independent tasks or work items (§9) need to be developed in parallel, spawn distinct `coder` subagent instances concurrently.
  - Running the full red-green-refactor loop (`tests/` -> code -> `bun test` & `bun run lint`).

---

## Delegation Rules of Thumb

1. **Quick single-file lookups / minor fixes**: Execute directly in the main session to minimize overhead.
2. **Open-ended codebase exploration / audits**: Delegate to `explore` (keeps main context clean and leverages fast Flash model).
3. **Multi-file implementation / heavy feature work**: Delegate to one or more `coder` instances with clear, bounded task prompts.
4. **Independent workstreams**: Invoke multiple `coder` subagents in a single `invoke_subagent` call so they work concurrently in the background.
