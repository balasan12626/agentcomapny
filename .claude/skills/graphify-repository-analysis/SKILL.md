---
name: graphify-repository-analysis
description: "Use for codebase architecture, dependency, impact or 'what calls X' questions; query the Graphify knowledge graph (graphify-out/) before grepping or reading many files."
---

# graphify-repository-analysis

**Scope:** Wraps the upstream Graphify skill/CLI (graphifyy, Apache-2.0). Repository intelligence only — not the task DB, authz engine or AI engine.

## Inputs
- Question to answer
- graphify-out/graph.json (build if absent and permitted)

## Workflow
1. Check `graphify --version`; if missing, follow docs/GRAPHIFY_INTEGRATION.md install steps (needs user approval) and stop.
2. If graphify-out/ is absent: `/graphify . --no-viz` (code is parsed locally by tree-sitter).
3. After source changes: `graphify update .` (incremental), not a full rebuild.
4. Answer with query/path/explain; open source only to confirm the 1-3 key edges.
5. Label each relationship EXTRACTED (in source) or INFERRED (resolved); verify INFERRED before relying on it.

## Graphify queries
- `graphify query "what calls runClaude?"`
- `graphify query "which modules can spawn processes or touch the filesystem?"`
- `graphify path "createTask" "enqueueTask"`
- `graphify explain "transitionTask"`
- `graphify query "what breaks if core/approvals.js changes?"`

## Tools & filesystem
Bash limited to `graphify` subcommands; Read for confirmation.

## Security
Respect .graphifyignore (secrets, .env, node_modules, build output). Do not enable a remote semantic backend for private code without explicit authorization. Do not run scripts from the downloaded Graphify repo; use the installed package.

## Output
Answer + evidence table: relation · source file:symbol · EXTRACTED/INFERRED · verified?

## Acceptance
- [ ] Claims cite concrete paths/symbols
- [ ] No INFERRED edge presented as verified
- [ ] Graph updated incrementally after code changes

## Escalation
Graphify unavailable → say so, fall back to project-discovery, and record BLOCKED in the checklist (task D-01).

## Token efficiency
One graph query replaces dozens of file reads; prefer `query` with a narrow question over reading GRAPH_REPORT.md in full.

## Checklist
Update affected rows in docs/IMPLEMENTATION_CHECKLIST.md (status, evidence, tokens) via `task-checklist-maintenance`.
