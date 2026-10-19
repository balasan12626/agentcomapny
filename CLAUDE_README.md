# Working on DATYLUNE AI OS with Claude Code

Human guide to how Claude Code is set up in this repo. (`CLAUDE.md` is the short version Claude itself loads every session — keep that one small; put long explanations here.)

## 1. One-time setup

```bash
npm i -g @anthropic-ai/claude-code      # if not installed
claude                                  # log in once; the platform reuses this login
cd agentcomapny && claude               # start a session in the repo
```

Optional but recommended — **Graphify** (code knowledge graph, saves tokens):

```bash
uv tool install graphifyy==0.9.92       # or: pipx install graphifyy==0.9.92  (package name has two y's)
graphify install --project              # adds the official /graphify skill to .claude/skills/graphify/
```
Then inside Claude Code: `/graphify . --no-viz` (first build). After code changes: `graphify update .`. Details: [docs/GRAPHIFY_INTEGRATION.md](docs/GRAPHIFY_INTEGRATION.md).

## 2. What Claude loads automatically

| File | Loaded | Purpose |
|---|---|---|
| `CLAUDE.md` | every session | stack, rules, token rules, commands, completion record |
| `.claude/settings.json` | every session | deny rules + the PreToolUse guard hook |
| `.claude/hooks/guard-secrets.mjs` | before Read/Edit/Write/Bash | blocks `.env*`, keys, `rm -rf /`, `git push --force`, `curl \| sh` |
| `.claude/agents/*.md` | when an agent is invoked | 19 role agents (generated — don't hand-edit) |
| `.claude/skills/*/SKILL.md` | only when relevant | 20 workflow skills |

The hook really does block things — a command that mentions `.env` directly is refused. Use the npm scripts instead (they load `.env` for you).

## 3. Starting a task (copy-paste prompts)

Claude follows the "start here" order in `CLAUDE.md` (handoff → checklist → graph → few files). Good prompts are short and specific:

```
Read docs/SESSION_HANDOFF.md, then do the top item under "Next". Follow the completion record.
```
```
Implement checklist row E-02 (validators as acceptance checks). Keep the diff small, add tests, update the checklist row with evidence and tokens.
```
```
Use the security-reviewer agent to review server/src/http/routes/index.js for tenant-isolation gaps. Report only; no edits.
```
```
/graphify query "what calls transitionTask?"
```

Ask for one agent unless you really need several. To fan out several agents in one go, say so explicitly (e.g. "use a workflow"); that costs more tokens.

## 4. Agents (roles)

Defined once in `catalog/agents.json` → `npm run generate:agents` → `.claude/agents/<slug>.md` → `npm run seed -w server` loads them into the app.

| Group | Agents | Tools |
|---|---|---|
| Executive | founder-agent, ceo-agent, chief-of-staff, cto-agent, cfo-agent, coo-agent | read-only |
| Product | product-manager, project-manager | read-only |
| Engineering | software-architect (read-only), frontend-engineer, backend-engineer, database-engineer, test-engineer | read + write + shell |
| Review | code-reviewer, qa-release-agent, security-reviewer, repo-cartographer | read + shell |
| Security | ciso-security-agent, bug-bounty-assistant | read-only |

Rules built in: executives are always read-only; no agent can approve its own risky action; a role title gives no extra permissions; bug-bounty work needs a written scope record first.

**Add or change an agent:** edit `catalog/agents.json` → `npm run generate:agents` → `npm run validate:claude` → `npm run seed -w server`.

## 5. Skills

Each skill is a small `SKILL.md` (name, description, inputs, workflow, Graphify queries, tools, security, output, acceptance, escalation, token tips). Claude loads one only when its description matches the task.

`project-discovery`, `graphify-repository-analysis`, `company-strategy`, `founder-planning`, `executive-reporting`, `product-requirements`, `multi-agent-orchestration`, `task-checklist-maintenance`, `nextjs-development`, `javascript-backend`, `mongodb-engineering`, `async-task-processing`, `testing-and-validation`, `secure-code-review`, `threat-modelling`, `authorized-bug-bounty`, `incident-response`, `production-readiness`, `token-efficient-execution`, `documentation-maintenance`.

**Add a skill:** create `.claude/skills/<kebab-name>/SKILL.md` with `name` (= folder name) and a `description` that says *when to use it*, include `## Workflow` and `## Acceptance`, keep it under 120 lines, then `npm run validate:claude`. In the web app, the **Skills Library** runs the same validator; imported scripts/hooks are quarantined until reviewed.

## 6. Keeping token use low

- Graph query → targeted grep → read part of a file → read a whole file (last resort).
- Ask Claude to summarize command output (`| tail`, pass/fail counts) instead of printing logs.
- One task per session where possible; start fresh sessions from `docs/SESSION_HANDOFF.md` instead of re-explaining.
- Don't ask it to "read the whole repo" or "re-check everything" — name the files or checklist rows.
- Skills and agents load only when needed; avoid adding long text to `CLAUDE.md`.

## 7. Token usage is recorded

- **In the app:** every agent run stores the real token counts Claude Code reports (input, output, cache, cost). They're summed per task, shown on the task page, Dashboard and Monitoring, and checked against the task's token/cost budget.
- **In the repo:** after each task Claude fills the **Tokens** column in `docs/IMPLEMENTATION_CHECKLIST.md` (real numbers when available, otherwise "≈Nk (session delta)", or `n/a`).

## 8. End of every task

Claude ends with the completion record from `CLAUDE.md` (what changed, files, checks run, evidence, security, open issues, checklist rows incl. tokens, next task), updates the checklist rows in place, and rewrites `docs/SESSION_HANDOFF.md`. If a test was skipped or blocked, it must say so — nothing counts as "done" without evidence.

## 9. Before you commit

```bash
npm test && npm run lint && npm run validate:claude && npm run build
```
