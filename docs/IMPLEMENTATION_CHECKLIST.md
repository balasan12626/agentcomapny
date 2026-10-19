# Implementation checklist

Statuses: NOT_STARTED · IN_PROGRESS · BLOCKED · IMPLEMENTED (code exists, not fully verified) · VERIFIED (checks passed, evidence cited) · DEFERRED.
Update rows in place (never renumber/delete). **Tokens** = token consumption of the work: runtime-reported usage when available, else "≈Nk (session delta)" from the Claude Code context counter, else `n/a`.
Session 1 (2026-10-19) total ≈ 140k tokens (session delta).

| ID | Phase | Work item | Owner | Status | Dependencies | Verification evidence | Tokens | Next action |
|---|---|---|---|---|---|---|---|---|
| A-01 | A | Existing application audit | lead | VERIFIED | - | docs/PROJECT_AUDIT.md; repo had no commits | ≈17k (session delta) | - |
| A-02 | A | Graphify inspection (version, license, commands) | repo-cartographer | VERIFIED | - | graphifyy 0.9.92, Apache-2.0, upstream skill.md read | incl. A-01 | - |
| A-03 | A | MetaGPT architecture + license review | software-architect | VERIFIED | - | MIT; roles/*.py read; docs/METAGPT_ADAPTATION.md | incl. A-01 | - |
| A-04 | A | Claude Code runtime compatibility | backend-engineer | IMPLEMENTED | - | `claude --help` 2.1.303 flags confirmed; `--max-turns` not listed (made opt-in) | ≈2k (session delta) | Run one real `claude -p` task end-to-end |
| A-05 | A | Security and dependency review | security-reviewer | NOT_STARTED | B-* | - | n/a | `npm audit`; secure-code-review of server/ |
| B-01 | B | Auth (scrypt, signed cookie, CSRF) + role permissions | backend-engineer | VERIFIED | - | unit: session tokens, authorize(), http baseline (401/403/400) pass | ≈27k (session delta, B-01..B-04 core) | Account recovery, logout-all |
| B-02 | B | Organizations, clients, projects, workspaces | backend-engineer | IN_PROGRESS | B-03 | Project list/create API + UI; org/client CRUD not built | incl. B-01 | Org/membership admin API |
| B-03 | B | MongoDB models and indexes | database-engineer | IMPLEMENTED | - | 17 models with org scope + compound/unique/TTL indexes; not run against a live DB | incl. B-01 | Run integration suite with MONGODB_TEST_URI; add workspaces, schedules, checkpoints, notifications, integrations, settings models |
| B-04 | B | Durable task queue (BullMQ) | backend-engineer | VERIFIED | - | integration (real redis-server): duplicate enqueue→1 job; SIGKILLed worker's job recovered (2/2 pass) | ≈24k (session delta, queue+tests) | - |
| B-05 | B | Local connector | backend-engineer | IN_PROGRESS | B-04 | connector unit tests 3/3 (local allowlist, usage report, backoff); server device gateway + enrollment not built | ≈5k (session delta) | Device enrollment/revocation + /device WS gateway |
| B-06 | B | Budgets per org/task | backend-engineer | IMPLEMENTED | B-03 | budgetViolation unit-tested; org defaults applied on create | incl. B-01 | Settings UI |
| C-01 | C | Founder and CEO agents | lead | VERIFIED | D-03 | catalog + generated .md; YAML parsed; executives forced read-only by generator | ≈24k (session delta, C+D agents/skills/hooks) | - |
| C-02 | C | Chief of Staff, CTO, CFO, COO, CISO | lead | VERIFIED | D-03 | same as C-01 | incl. C-01 | - |
| C-03 | C | Product, project, QA, reviewer, engineering, security, bug-bounty roles | lead | VERIFIED | D-03 | 19 agents in sync (`validate:claude`) | incl. C-01 | - |
| C-04 | C | Agent registry and versioning | backend-engineer | IN_PROGRESS | B-03 | seed creates hash-versioned PUBLISHED versions; read APIs; no write/rollback API | incl. B-01 | Agent Builder write API + UI |
| C-05 | C | Bounded subagent coordination | backend-engineer | IMPLEMENTED | C-04 | buildPlan depth/parallel limits unit-tested; orchestrator test written but skipped (no MongoDB) | incl. B-01 | Run orchestrator integration test |
| C-06 | C | Restricted ops cannot be self-authorized (Founder/CEO) | security-reviewer | VERIFIED | - | unit: canExecuteRestricted, SELF_APPROVAL, AGENT_CANNOT_APPROVE | incl. B-01 | Wire canExecuteRestricted into tool execution path |
| D-01 | D | Graphify install + graph generation | repo-cartographer | BLOCKED | - | `pip install graphifyy` denied by session permission policy | ≈1k (session delta) | User: run install steps in docs/GRAPHIFY_INTEGRATION.md |
| D-02 | D | Graph queries + secret-exclusion check | repo-cartographer | BLOCKED | D-01 | .graphifyignore written | incl. D-01 | Run the 4 verification steps |
| D-03 | D | Agent and skill templates | lead | VERIFIED | - | 20 skills pass validator + YAML parse; generator `--check` in sync | incl. C-01 | - |
| D-04 | D | Skills Library (validate, versions, approve) | backend-engineer | IMPLEMENTED | B-03 | validator unit-tested; API routes untested against DB | incl. B-01 | Integration tests; disable/rollback endpoints; diff view |
| D-05 | D | Skill import review (traversal, quarantine, injection) | security-reviewer | VERIFIED | - | unit: unsafe paths rejected, scripts quarantined, injection phrases rejected | incl. B-01 | Archive (zip) upload with size limits |
| D-06 | D | Deterministic hooks | security-reviewer | VERIFIED | - | hooks.test.js 9 assertions pass | incl. C-01 | - |
| E-01 | E | Execution modes | backend-engineer | IMPLEMENTED | C-05 | mode timeouts + default ACs; SCHEDULED has no scheduler | incl. B-01 | Durable scheduler |
| E-02 | E | Validators (tests/build) as acceptance checks | backend-engineer | NOT_STARTED | E-01 | - | n/a | Run project validators via checkCommand + pathGuard |
| E-03 | E | Live graph (React Flow) | frontend-engineer | IMPLEMENTED | E-04 | `next build` passes; nodes only from persisted plan/runs; not exercised against live data | ≈19k (session delta, web) | E2E test with seeded task |
| E-04 | E | Streaming events + missed-event replay | backend-engineer | IMPLEMENTED | B-03 | seq + eventsSince + WS replay; integration test skipped (no MongoDB) | incl. B-01 | Run integration suite |
| E-05 | E | Claude sessions view, logs, diffs | frontend-engineer | NOT_STARTED | E-04 | session id shown per run only | n/a | Diff/artifact service |
| E-06 | E | Approval inbox | frontend-engineer | IMPLEMENTED | - | UI built; API decision path in skipped integration test | incl. E-03 | Run integration suite |
| E-07 | E | Recovery and resume | backend-engineer | IMPLEMENTED | B-04 | recoverQueued() sweep; stalled-job recovery verified (B-04). Gap: API cancel sets CANCELLED but does not yet signal the worker process | incl. B-04 | Redis pub/sub cancel → cancelLocal(); checkpoints + `--resume` |
| E-08 | E | Per-task token consumption tracking | backend-engineer | VERIFIED | - | unit: usage parsed from Claude `result` events, budgets enforced; UI shows per-task tokens | incl. B-01 | Verify with a real Claude run |
| F-01 | F | Tenant isolation | security-reviewer | IMPLEMENTED | B-03 | authorize() unit-tested; HTTP/WS cross-tenant tests skipped (no MongoDB) | incl. B-01 | Run integration suite |
| F-02 | F | Connector permissions / workspace restrictions | security-reviewer | VERIFIED | - | pathGuard: traversal, symlink escape, denylist; connector rejects non-allowlisted root | incl. B-01 | - |
| F-03 | F | Command restrictions (argv + allowlist) | security-reviewer | VERIFIED | - | checkCommand unit tests; adapter uses spawn shell:false | incl. B-01 | - |
| F-04 | F | Audit trails | backend-engineer | IMPLEMENTED | B-03 | audit() on login, project, skill, approval, scope | incl. B-01 | Integration test |
| F-05 | F | Defensive security agents | lead | VERIFIED | D-03 | ciso, security-reviewer, bug-bounty agents + 10 DB catalog roles | incl. C-01 | - |
| F-06 | F | Authorized bug-bounty workflow | security-reviewer | VERIFIED | - | unit: no scope→PASSIVE_ONLY, excluded/out-of-scope→DENIED, finding lifecycle | incl. B-01 | Finding create API |
| F-07 | F | Approval binding (hash, expiry, single use) | security-reviewer | VERIFIED | - | unit: PAYLOAD_MISMATCH, EXPIRED, ALREADY_USED/NOT_APPROVED | incl. B-01 | - |
| F-08 | F | Integrations with scoped credentials | backend-engineer | NOT_STARTED | - | none configured | n/a | Design credential vault |
| G-01 | G | Performance and load testing | qa-release-agent | NOT_STARTED | B-*, E-* | - | n/a | - |
| G-02 | G | Recovery exercises | qa-release-agent | NOT_STARTED | E-07 | - | n/a | - |
| G-03 | G | Monitoring and alerting | backend-engineer | IN_PROGRESS | - | health endpoint + monitoring page; no queue/worker metrics | incl. E-03 | Queue latency + worker heartbeat |
| G-04 | G | Backup and restore verification | database-engineer | NOT_STARTED | - | commands documented only | n/a | Restore drill |
| G-05 | G | Documentation and runbooks | documentation | IMPLEMENTED | - | CLAUDE.md, ARCHITECTURE, SETUP, GRAPHIFY, METAGPT, AUDIT | ≈14k (session delta) | Incident runbook |

## Acceptance tests (prompt §15) → evidence
1 CLAUDE.md ✔ (`validate:claude`) · 2 Graphify ✖ BLOCKED · 3 graph query ✖ BLOCKED · 4 graph secrets ✖ BLOCKED · 5 agent/skill versions ◐ (seed code, untested on DB) · 6 skills can't grant tools ✔ · 7 tenant isolation ◐ (unit ✔, HTTP skipped) · 8 idempotent create ◐ (queue ✔, HTTP skipped) · 9 queue recovery ✔ · 10 WS tenant auth ◐ (skipped) · 11 graph from persisted events ◐ (by construction, not e2e) · 12 checklist keeps history ✔ · 13 Founder/CEO can't self-authorize ✔ · 14 bug-bounty scope ✔ · 15 high-risk needs approval ✔ · 16 approval payload change ✔ · 17 build + tests ✔ (`npm test`, `npm run build`).
