# MetaGPT-inspired role architecture

Reference: https://github.com/FoundationAgents/MetaGPT (MIT, © 2024 Chenglin Wu). Inspected `metagpt/roles/{product_manager,architect,project_manager,engineer,qa_engineer}.py`.
**No MetaGPT code or Python runtime is used.** Only the concepts below are adapted, re-implemented in JavaScript. Claude Code remains the sole execution engine.

| MetaGPT concept | Upstream | DATYLUNE implementation |
|---|---|---|
| Role = profile + goal + constraints | `Role.profile/goal/constraints` | `catalog/agents.json`: `mission`, `does`, `never` → `.claude/agents/*.md` |
| Actions a role performs | `set_actions([WritePRD])` | `skills` (SKILL.md workflows) per agent |
| Subscribe to upstream outputs | `_watch([WritePRD])` | `watches` / `produces` artifact types |
| SOP pipeline PM → Architect → PM → Engineer → QA | message-driven | `core/roleGraph.js buildPlan()` derives stages + edges from watches/produces, bounded by depth and parallelism |
| Structured deliverables | PRD, design, task list | Artifact types: PRD, SystemDesign, TaskList, Code, TestReport, ReviewReport, ReleaseDecision |

Differences by design: roles are governed identities (least-privilege toolsets, executives read-only), every run passes policy + approval gates, and usage/budgets are tracked per run. Example derived pipeline (unit-tested):
`product-manager (PRD) → software-architect (SystemDesign) → project-manager (TaskList) → backend-engineer (Code) → test-engineer / code-reviewer → qa-release-agent`.
