---
name: multi-agent-orchestration
description: "Use when a task needs more than one specialist agent, parallel work, or a dependency-ordered plan."
---

# multi-agent-orchestration

**Scope:** Coordinator workflow on the platform orchestrator (server/src/services/orchestrator.js) or Claude Code subagents.

## Inputs
- Task objective + ACs
- Candidate agents from catalog/agents.json (watches/produces)

## Workflow
1. Use one agent unless specialists add clear value.
2. Order work by artifact flow (watches → produces); buildPlan() enforces depth and parallel limits.
3. Give each agent a brief: objective, files, constraints, ACs, output format (≤200 words).
4. Parallel code changes → separate git worktrees; never two agents on one working tree.
5. Integrate: verify each output, then one integration review for cross-cutting changes.

## Graphify queries
- `graphify query "modules touched by <change>" to split work without overlap`

## Tools & filesystem
Task/subagent tool only with bounded depth (MAX_DELEGATION_DEPTH, default 6) and concurrency (MAX_PARALLEL_AGENTS, default 3).

## Security
Subagents get least-privilege tools from their catalog toolset; a brief never grants more.

## Output
Plan (stages + edges) · per-agent result · integration verdict.

## Acceptance
- [ ] No unbounded chains
- [ ] Each agent result verified before use
- [ ] Usage recorded per agent run

## Escalation
Agent fails twice on the same condition → stop and escalate with evidence.

## Token efficiency
Pass summaries and paths between agents, never full transcripts; do not make every agent reread the repo.

## Checklist
Update affected rows in docs/IMPLEMENTATION_CHECKLIST.md (status, evidence, tokens) via `task-checklist-maintenance`.
