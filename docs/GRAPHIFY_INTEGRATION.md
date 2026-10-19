# Graphify integration

| Item | Value |
|---|---|
| Upstream | https://github.com/Graphify-Labs/graphify (inspected at commit `86c57be`, 2026-10-16) |
| Package | `graphifyy` **0.9.92** on PyPI (double "y" — other `graphify*` packages are unaffiliated); CLI is `graphify` |
| License | Apache-2.0 (+ LICENSE-MIT, NOTICE) — usable as a tool; nothing vendored into this repo |
| Runtime | Python ≥ 3.10 (container has 3.13); tree-sitter grammars incl. JavaScript |
| Status | **BLOCKED in the cloud session**: installing the package was denied by the session's permission policy. Not installed, no graph generated yet. |

## Install (run on a dev machine, once)
```bash
uv tool install graphifyy==0.9.92      # or: pipx install graphifyy==0.9.92
graphify install --project             # writes .claude/skills/graphify/SKILL.md (+ references/) — commit it
graphify --version                     # verify
```
`graphify install --project` installs the upstream skill beside our wrapper skill
`.claude/skills/graphify-repository-analysis/` (which adds DATYLUNE rules: evidence labels, exclusions, checklist).
Do not run scripts from a downloaded copy of the Graphify repo; use the installed package.

## Build and keep current
```bash
/graphify . --no-viz          # first build (in Claude Code); add viz by dropping --no-viz
graphify update .             # incremental after code changes
graphify hook install         # optional: rebuild on commit/checkout
```
Outputs go to `graphify-out/`: `graph.json` (query target), `GRAPH_REPORT.md`, `graph.html`. `graphify-out/cache/` is git-ignored.
Code is parsed locally with tree-sitter (no LLM, nothing leaves the machine). The semantic pass over docs/media uses a model backend — **do not configure a remote backend for private code without explicit authorization**.

## Exclusions
`.graphifyignore` (plus `.gitignore`) excludes `.env*`, keys/certs, `node_modules`, `.next`, lockfiles, artifact stores. Review it before indexing a new directory.

## Questions the graph should answer
```bash
graphify query "where is task orchestration implemented?"        # expect services/orchestrator.js
graphify query "what calls runClaude?"                           # orchestrator, connector
graphify query "which modules spawn processes or access files?"  # adapters/claudeCode.js, core/pathGuard.js
graphify path "createTask" "enqueueTask"
graphify explain "consumeApproval"
graphify query "what may break if core/taskStateMachine.js changes?"
```
Every edge is tagged EXTRACTED (in source) or INFERRED (resolved). Cite concrete `file:symbol` and verify INFERRED edges before acting.

## Verification still owed (checklist D-01/D-02)
1. `graphify --version` prints 0.9.92. 2. `/graphify . --no-viz` creates `graphify-out/graph.json`. 3. `graphify query "what calls runClaude?"` returns `server/src/services/orchestrator.js`. 4. `grep -c "SESSION_SECRET=" graphify-out/graph.json` finds no secret values (only `.env.example` key names may appear).
