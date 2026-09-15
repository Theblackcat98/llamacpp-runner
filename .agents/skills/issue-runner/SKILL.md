---
name: issue-runner
description: Guidelines and procedure for picking up, implementing, verifying, and closing GitHub issues autonomously when requested by the user.
---

# Issue Runner Skill

This skill guides the agent through picking up tasks from GitHub Issues and executing them end-to-end adhering to repository standards in [AGENTS.md](file:///home/nick/Documents/Projects/llamacpp-runner/AGENTS.md).

## Trigger Conditions
Activate this skill whenever the user says:
- *"work on the next issue"*
- *"pick up the next task"*
- *"work on issue #<id>"*
- *"start next bug/feature"*

## Workflow Steps

### 1. Identify Target Issue
- If specific ID provided:
  `gh issue view <id> --json number,title,body,labels`
- If "next issue":
  `gh issue list --state open --label "ready" --limit 5`
  Sort by: `priority:high` first, then oldest issue ID (FIFO).
  If no issues have `ready`, list open issues:
  `gh issue list --state open --limit 5`

### 2. Claim Issue
Mark as claimed to prevent conflicting runs:
```bash
gh issue edit <id> --add-label "in-progress"
```
Present the issue title and task plan to the user.

### 3. Branching
Strictly respect layer isolation (never mix `src/core` and `src/ui`):
```bash
git checkout main && git pull
git checkout -b issue/<id>-<slug>
```

### 4. Implementation Loop
- Consult [plans/llamamanager.md](file:///home/nick/Documents/Projects/llamacpp-runner/plans/llamamanager.md) if the issue references a spec section (§).
- Write failing unit/integration tests first.
- Implement minimal necessary code to pass tests.
- For large or complex tasks, delegate implementation to the `coder` subagent.

### 5. Verification
Run the verification suite:
```bash
bun run lint && bun run typecheck && bun test
```
If `src/core/supervisor` was touched, run the teardown/orphan suite.

### 6. Commit, Merge, and Close
Follow commit convention `scope: behavior (§ref)`:
```bash
git commit -m "issue #<id>: <summary>"
git checkout main
git merge --no-ff issue/<id>-<slug>
git branch -d issue/<id>-<slug>
gh issue close <id> --comment "Resolved on main in commit $(git rev-parse --short HEAD)"
gh issue edit <id> --remove-label "in-progress"
```
Report final status and test results to the user.
