---
name: token-efficient-execution
description: "Use on every non-trivial task to minimize context and token use without losing correctness; also defines how token usage is recorded per task."
---

# token-efficient-execution

**Scope:** Operating discipline for all agents.

## Inputs
- Task objective

## Workflow
1. Read CLAUDE.md + handoff + the one checklist row; skip anything already answered there.
2. Graph first (graphify query/path/explain), then targeted reads (offset/limit, grep -n).
3. Plan only for multi-step work; trivial edits go straight to diff + test.
4. Delegate only independent work; briefs ≤200 words with paths and ACs.
5. Summarize outputs (tail/grep) — never paste full logs, lockfiles or trees.
6. Record usage: platform tasks store Claude Code result usage (UsageRecord, Task.usage); session work logs the token delta in the checklist Tokens column.

## Graphify queries
- `graphify query "<narrow question>" instead of opening many files`

## Tools & filesystem
No extra tools.

## Security
Never drop safety or acceptance checks to save tokens.

## Output
Brief completion record (CLAUDE.md format) incl. tokens used.

## Acceptance
- [ ] No full-repo reads
- [ ] No repeated verification of unchanged evidence
- [ ] Tokens recorded

## Escalation
Budget (Task.budget / --max-budget-usd) exceeded → stop, report, ask.

## Token efficiency
Biggest wins: graph queries, partial reads, summary-only command output, no duplicate planning.

## Checklist
Update affected rows in docs/IMPLEMENTATION_CHECKLIST.md (status, evidence, tokens) via `task-checklist-maintenance`.
