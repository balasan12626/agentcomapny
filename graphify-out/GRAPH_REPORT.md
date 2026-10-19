# Graph Report - agentcomapny  (2026-10-19)

## Corpus Check
- 180 files · ~97,938 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: (none) 2, .example 1, .css 1)

## Summary
- 1235 nodes · 2645 edges · 91 communities (68 shown, 23 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 95 edges (avg confidence: 0.92)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `dcf1ede2`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- services/workflow.js
- agentOutputs.js
- governance.test.js
- server/package.json
- DATYLUNE AI OS
- models/index.js
- orchestrator.js
- taskStateMachine.js
- useOrgApi
- routes/index.js
- apiRouter
- StatusBadge
- api
- integration/workflow.test.js
- worker.js
- scripts
- skillValidator.js
- [taskId]/page.jsx
- Shell.jsx
- Session handoff
- web/package.json
- ref_node_fs
- services/approvals.js
- workspaces.js
- mongoose
- connector/package.json
- claudeCode.js
- generate-claude-agents.mjs
- redact.js
- react
- ref_node_fs
- workflowAgents.test.js
- async-task-processing
- documentation-maintenance
- graphify-repository-analysis
- javascript-backend
- mongodb-engineering
- multi-agent-orchestration
- nextjs-development
- product-requirements
- threat-modelling
- token-efficient-execution
- Part A — Company workflow
- authorized-bug-bounty
- company-strategy
- founder-planning
- incident-response
- production-readiness
- project-discovery
- secure-code-review
- task-checklist-maintenance
- testing-and-validation
- workflowAgents.js
- executive-reporting
- server/src/index.js
- Pending
- Agent-platform evaluation (DATYLUNE AI OS)
- skillValidator.js
- Project audit — 2026-10-19
- api.test.js
- next.config.mjs
- compilerOptions
- hooks/README.md
- workflowSteps.js
- Phase 3 — Agent roles, prompts and output schemas ✅ DONE (Session 16)
- DATYLUNE AI OS — Claude Code operating manual
- queue.test.js
- bugBountyScope.js
- toolPolicy.js
- skills/page.jsx

## God Nodes (most connected - your core abstractions)
1. `api()` - 50 edges
2. `useOrgApi()` - 49 edges
3. `apiRouter()` - 37 edges
4. `Phase 2 — Workflow state machine + rules ✅ DONE (Session 15)` - 31 edges
5. `react` - 28 edges
6. `move()` - 27 edges
7. `executeTask()` - 24 edges
8. `errorText()` - 24 edges
9. `Session handoff` - 22 edges
10. `WorkflowError` - 21 edges

## Surprising Connections (you probably didn't know these)
- `Session 15 (2026-10-19) — Workflow Phases 1 + 2 complete` --references--> `move()`  [INFERRED]
  docs/SESSION_HANDOFF.md → server/src/services/workflow.js
- `Session 5 (2026-10-19) — H-06: CEO Orchestrator chat page (IN_PROGRESS)` --references--> `useTaskEvents()`  [INFERRED]
  docs/SESSION_HANDOFF.md → web/lib/useTaskEvents.js
- `Implementation checklist` --references--> `text()`  [INFERRED]
  docs/IMPLEMENTATION_CHECKLIST.md → server/src/core/agentOutputs.js
- `Phase 3 — Agent roles, prompts and output schemas ✅ DONE (Session 16)` --references--> `extractJson()`  [INFERRED]
  docs/PHASES.md → server/src/core/agentOutputs.js
- `Implementation checklist` --references--> `planToTask()`  [INFERRED]
  docs/IMPLEMENTATION_CHECKLIST.md → server/src/core/ceoRouter.js

## Import Cycles
- None detected.

## Communities (91 total, 23 thin omitted)

### Community 0 - "services/workflow.js"
Cohesion: 0.06
Nodes (88): Phase 2 — Workflow state machine + rules ✅ DONE (Session 15), afterFailure(), allowedTransitions(), BA_RECOMMENDATIONS, budgetCheck(), canDecide(), canExecute(), canManage() (+80 more)

### Community 1 - "agentOutputs.js"
Cohesion: 0.10
Nodes (20): zod, baSpecSchema, ceoBriefSchema, criterion, deliverableReportSchema, extractJson(), feature, headAssignSchema (+12 more)

### Community 2 - "governance.test.js"
Cohesion: 0.07
Nodes (36): allAgents(), coreRoles, counts, departmentHeads, departmentName(), DEPARTMENTS, executive, KNOWN_SKILLS (+28 more)

### Community 3 - "server/package.json"
Cohesion: 0.05
Nodes (40): cookie, cookie-parser, express-rate-limit, helmet, ioredis, dependencies, bullmq, cookie (+32 more)

### Community 4 - "DATYLUNE AI OS"
Cohesion: 0.05
Nodes (36): 1. One-time setup, 2. What Claude loads automatically, 3. Starting a task (copy-paste prompts), 4. Agents (roles), 5. Skills, 6. Keeping token use low, 7. Token usage is recorded, 8. End of every task (+28 more)

### Community 5 - "models/index.js"
Cohesion: 0.07
Nodes (33): actorRef, agentRunSchema, agentSchema, agentVersionSchema, Artifact, CeoDecision, ClientFeedback, ClientRequest (+25 more)

### Community 6 - "orchestrator.js"
Cohesion: 0.18
Nodes (17): redactPaths(), redactPathsDeep(), buildPlan(), PlanError, completionBlockers(), resolveTools(), AgentRun, brief() (+9 more)

### Community 7 - "taskStateMachine.js"
Cohesion: 0.28
Nodes (7): assertTransition(), canTransition(), InvalidTransitionError, TASK_STATES, TERMINAL_STATES, TRANSITIONS, WORKER_STATES

### Community 8 - "useOrgApi"
Cohesion: 0.10
Nodes (24): next, Agents(), KIND, Audit(), HREF, Catalog(), RoleCard(), ACTIVE (+16 more)

### Community 9 - "routes/index.js"
Cohesion: 0.17
Nodes (14): express, CANONICAL_KINDS, objectId, rootsSchema, BugBountyScope, Client, Department, RegisteredDevice (+6 more)

### Community 10 - "apiRouter"
Cohesion: 0.19
Nodes (18): b64(), signToken(), verifyPassword(), verifyToken(), createApp(), authenticate(), csrf(), errorHandler() (+10 more)

### Community 11 - "StatusBadge"
Cohesion: 0.15
Nodes (19): AgentDetail(), AgentLink(), KIND, ago(), Dashboard(), fmt(), STATUS_CARDS, WORKER (+11 more)

### Community 12 - "api"
Cohesion: 0.23
Nodes (22): run(), Clients(), NewClient(), submit(), NewProject(), submit(), Unassigned(), assign() (+14 more)

### Community 13 - "integration/workflow.test.js"
Cohesion: 0.15
Nodes (7): mongodb-memory-server, migrateWorkflowV1(), revertWorkflowV1(), approvedWithOneItem(), evidence, SPEC, toCeo()

### Community 14 - "worker.js"
Cohesion: 0.24
Nodes (14): Session 13 (2026-10-19) — Audit remediation (DATYLUNE_AI_OS_Audit, score 5.2), CANCEL_POLL_MS, controllers, processTask(), recoverQueued(), watchCancellation(), markStalled(), cancelTask() (+6 more)

### Community 15 - "scripts"
Cohesion: 0.09
Nodes (22): description, engines, node, name, private, scripts, build, dev (+14 more)

### Community 16 - "skillValidator.js"
Cohesion: 0.17
Nodes (15): ApprovalError, consumeApproval(), createApprovalRequest(), decideApproval(), DEFAULT_APPROVAL_TTL_MS, canonicalJson(), payloadHash(), sha256() (+7 more)

### Community 17 - "[taskId]/page.jsx"
Cohesion: 0.17
Nodes (13): react, AgentChat(), loadThread(), send(), Approvals(), describe(), NOISY, TaskDetail() (+5 more)

### Community 18 - "Shell.jsx"
Cohesion: 0.13
Nodes (23): lucide-react, metadata, RootLayout(), Login(), submit(), Frame(), isActive(), NAV (+15 more)

### Community 19 - "Session handoff"
Cohesion: 0.10
Nodes (19): Blockers, Current state (2026-10-19, session 1), Decisions, Next (in order), Session 10 (2026-10-19) — Client/project-scoped workspace foundation, Session 11 (2026-10-19) — Operations home, sessions and project skills, Session 12 (2026-10-19) — Consolidated operating summary and Graphify check, Session 14 (2026-10-19) — IT-company workflow: Phase 0 blockers (+11 more)

### Community 20 - "web/package.json"
Cohesion: 0.12
Nodes (15): react-dom, @xyflow/react, dependencies, lucide-react, next, react, react-dom, @xyflow/react (+7 more)

### Community 21 - "ref_node_fs"
Cohesion: 0.17
Nodes (14): backoffMs(), createConnector(), handleAssign(), onMessage(), start(), stop(), config, connect() (+6 more)

### Community 22 - "services/approvals.js"
Cohesion: 0.17
Nodes (18): authorize(), hasPermission(), P, PERMISSIONS, ROLE_PERMISSIONS, ROLES, SESSION_COOKIE, Approval (+10 more)

### Community 23 - "workspaces.js"
Cohesion: 0.10
Nodes (22): Mandatory rules, active, actor, APPLY, archivedIds, backup, completedIn, plan (+14 more)

### Community 24 - "mongoose"
Cohesion: 0.15
Nodes (13): mongoose, [slug, name, email], args, catalog, defs, departments, root, connectDb() (+5 more)

### Community 25 - "connector/package.json"
Cohesion: 0.14
Nodes (13): dependencies, @datylune/server, ws, ws, main, name, private, scripts (+5 more)

### Community 26 - "claudeCode.js"
Cohesion: 0.22
Nodes (12): buildClaudeArgs(), createLineParser(), normalizeEvent(), runClaude(), write(), redactDeep(), addUsage(), budgetViolation() (+4 more)

### Community 27 - "generate-claude-agents.mjs"
Cohesion: 0.25
Nodes (6): catalog, check, errors, outDir, root, skillsDir

### Community 28 - "redact.js"
Cohesion: 0.26
Nodes (11): Phase 0 — Fix blockers ✅ DONE (Session 14), ABS_PATHS, escapeRe(), HOME_PATHS, lastSegment(), looksLikePath(), PATTERNS, redact() (+3 more)

### Community 29 - "react"
Cohesion: 0.24
Nodes (14): Ceo(), CeoView(), PlanView(), FILTERS, NewTask(), Tasks(), TasksView(), AgentPicker() (+6 more)

### Community 30 - "ref_node_fs"
Cohesion: 0.08
Nodes (11): env, mongo, procs, redis, RESTART, start(), checks, env (+3 more)

### Community 31 - "workflowAgents.test.js"
Cohesion: 0.17
Nodes (7): FILE_OF, PLAN, planIdOf(), queue(), SPEC, specialist(), STEP_OF

### Community 32 - "async-task-processing"
Cohesion: 0.17
Nodes (11): Acceptance, async-task-processing, Checklist, Escalation, Graphify queries, Inputs, Output, Security (+3 more)

### Community 33 - "documentation-maintenance"
Cohesion: 0.17
Nodes (11): Acceptance, Checklist, documentation-maintenance, Escalation, Graphify queries, Inputs, Output, Security (+3 more)

### Community 34 - "graphify-repository-analysis"
Cohesion: 0.17
Nodes (11): Acceptance, Checklist, Escalation, Graphify queries, graphify-repository-analysis, Inputs, Output, Security (+3 more)

### Community 35 - "javascript-backend"
Cohesion: 0.17
Nodes (11): Acceptance, Checklist, Escalation, Graphify queries, Inputs, javascript-backend, Output, Security (+3 more)

### Community 36 - "mongodb-engineering"
Cohesion: 0.17
Nodes (11): Acceptance, Checklist, Escalation, Graphify queries, Inputs, mongodb-engineering, Output, Security (+3 more)

### Community 37 - "multi-agent-orchestration"
Cohesion: 0.17
Nodes (11): Acceptance, Checklist, Escalation, Graphify queries, Inputs, multi-agent-orchestration, Output, Security (+3 more)

### Community 38 - "nextjs-development"
Cohesion: 0.17
Nodes (11): Acceptance, Checklist, Escalation, Graphify queries, Inputs, nextjs-development, Output, Security (+3 more)

### Community 39 - "product-requirements"
Cohesion: 0.17
Nodes (11): Acceptance, Checklist, Escalation, Graphify queries, Inputs, Output, product-requirements, Security (+3 more)

### Community 40 - "threat-modelling"
Cohesion: 0.17
Nodes (11): Acceptance, Checklist, Escalation, Graphify queries, Inputs, Output, Security, threat-modelling (+3 more)

### Community 41 - "token-efficient-execution"
Cohesion: 0.17
Nodes (11): Acceptance, Checklist, Escalation, Graphify queries, Inputs, Output, Security, Token efficiency (+3 more)

### Community 42 - "Part A — Company workflow"
Cohesion: 0.29
Nodes (7): Part A — Company workflow, Phase 1 — Data model ✅ DONE (Session 15), Phase 4 — API endpoints ⏳, Phase 5 — UI ⏳, Phase 6 — Data clean-up ⏳, Phase 7 — Testing (must pass before "done") ⏳, Target flow (8 stages)

### Community 43 - "authorized-bug-bounty"
Cohesion: 0.18
Nodes (10): Acceptance, authorized-bug-bounty, Checklist, Escalation, Inputs, Output, Security, Token efficiency (+2 more)

### Community 44 - "company-strategy"
Cohesion: 0.18
Nodes (10): Acceptance, company-strategy, Escalation, Graphify queries, Inputs, Output, Security, Token efficiency (+2 more)

### Community 45 - "founder-planning"
Cohesion: 0.18
Nodes (10): Acceptance, Checklist, Escalation, founder-planning, Inputs, Output, Security, Token efficiency (+2 more)

### Community 46 - "incident-response"
Cohesion: 0.18
Nodes (10): Acceptance, Escalation, Graphify queries, incident-response, Inputs, Output, Security, Token efficiency (+2 more)

### Community 47 - "production-readiness"
Cohesion: 0.18
Nodes (10): Acceptance, Checklist, Escalation, Inputs, Output, production-readiness, Security, Token efficiency (+2 more)

### Community 48 - "project-discovery"
Cohesion: 0.18
Nodes (10): Acceptance, Escalation, Graphify queries, Inputs, Output, project-discovery, Security, Token efficiency (+2 more)

### Community 49 - "secure-code-review"
Cohesion: 0.18
Nodes (10): Acceptance, Escalation, Graphify queries, Inputs, Output, secure-code-review, Security, Token efficiency (+2 more)

### Community 50 - "task-checklist-maintenance"
Cohesion: 0.18
Nodes (10): Acceptance, Checklist, Escalation, Inputs, Output, Security, task-checklist-maintenance, Token efficiency (+2 more)

### Community 51 - "testing-and-validation"
Cohesion: 0.18
Nodes (10): Acceptance, Checklist, Escalation, Inputs, Output, Security, testing-and-validation, Token efficiency (+2 more)

### Community 52 - "workflowAgents.js"
Cohesion: 0.19
Nodes (17): DEFAULT_SPECIALIST_CAP_USD, workflowRolesOf(), afterWorkflowTask(), agentAs(), apply(), applyPlan(), applySpec(), checkOutputs() (+9 more)

### Community 53 - "executive-reporting"
Cohesion: 0.20
Nodes (9): Acceptance, Escalation, executive-reporting, Inputs, Output, Security, Token efficiency, Tools & filesystem (+1 more)

### Community 54 - "server/src/index.js"
Cohesion: 0.23
Nodes (10): logger, detectStalls(), minutes(), STALL_DEFAULTS, port, server, startHeartbeat(), startStallSweeper() (+2 more)

### Community 55 - "Pending"
Cohesion: 0.38
Nodes (5): Builder(), Devices(), Organizations(), Settings(), Pending()

### Community 56 - "Agent-platform evaluation (DATYLUNE AI OS)"
Cohesion: 0.22
Nodes (8): Agent-platform evaluation (DATYLUNE AI OS), Comparison (verification states), License + platform gating (decisive), Mission Control — install + launch attempt (2026-10-19), Not done / staged (honest), Recommendation (Phase 7), Verified clone metadata, What each one actually is (source + README review)

### Community 57 - "skillValidator.js"
Cohesion: 0.18
Nodes (13): claudeMd, errors, root, skillsDir, THIRD_PARTY, parseFrontmatter(), toList(), isSafeArchiveEntry() (+5 more)

### Community 58 - "Project audit — 2026-10-19"
Cohesion: 0.25
Nodes (7): Claude Code compatibility, Graphify (inspected, not installed), MetaGPT (inspected, concepts only), Not built / simulated: nothing is simulated. Unbuilt views render an honest "not implemented" state with a checklist ID., Project audit — 2026-10-19, Starting state (evidence), What was built this session — see IMPLEMENTATION_CHECKLIST.md for status per item.

### Community 59 - "api.test.js"
Cohesion: 0.18
Nodes (12): Session 4 (cont.) — company catalogue seeded + dynamic CEO router, Session 6 (2026-10-19) — REAL `claude -p` execution verified end-to-end + 3 orchestration bug fixes + external-platform evaluation, supertest, planToTask(), hashPassword(), createTask(), enqueued, H (+4 more)

### Community 61 - "compilerOptions"
Cohesion: 0.50
Nodes (3): compilerOptions, baseUrl, paths

### Community 84 - "workflowSteps.js"
Cohesion: 0.38
Nodes (13): baPrompt(), ceoBriefPrompt(), contract(), criteriaFor(), deliverablePrompt(), fence(), headAssignPrompt(), headReviewPrompt() (+5 more)

### Community 85 - "Phase 3 — Agent roles, prompts and output schemas ✅ DONE (Session 16)"
Cohesion: 0.18
Nodes (10): Repo map, DATYLUNE AI OS — Delivery phases, Part B — Client Agent demo ⛔ (needs Phases 1–5), Phase 3 — Agent roles, prompts and output schemas ✅ DONE (Session 16), Report required after each phase, ▶ Start here next session (Phases 4 → 7), reworkNotes(), advance() (+2 more)

### Community 86 - "DATYLUNE AI OS — Claude Code operating manual"
Cohesion: 0.20
Nodes (9): Commands, Completion record (end of every meaningful task), DATYLUNE AI OS — Claude Code operating manual, Every task: start here (cheap → expensive), graphify, Runtime boundaries, Stack (do not change without explicit approval), Token efficiency (+1 more)

### Community 87 - "queue.test.js"
Cohesion: 0.47
Nodes (6): bullmq, QUEUE_NAME, redis(), enqueueTask(), taskQueue(), createWorker()

### Community 88 - "bugBountyScope.js"
Cohesion: 0.32
Nodes (7): assessmentMode(), canAdvanceFinding(), FINDING_NEXT, FINDING_STATES, hostMatches(), REQUIRED, validateScope()

### Community 89 - "toolPolicy.js"
Cohesion: 0.33
Nodes (5): checkCommand(), DEFAULT_ALLOWED_COMMANDS, DENIED_ARGS, KNOWN_TOOLS, READ_ONLY_TOOLS

### Community 90 - "skills/page.jsx"
Cohesion: 0.83
Nodes (3): asList(), Outcome(), Skills()

## Knowledge Gaps
- **4 isolated node(s):** `ws`, `@datylune/server`, `ws`, `react-dom`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 622 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **23 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `api()` connect `api` to `useOrgApi`, `[taskId]/page.jsx`, `Shell.jsx`, `Phase 3 — Agent roles, prompts and output schemas ✅ DONE (Session 16)`, `skills/page.jsx`, `react`?**
  _High betweenness centrality (0.126) - this node is a cross-community bridge._
- **Are the 30 inferred relationships involving `Phase 2 — Workflow state machine + rules ✅ DONE (Session 15)` (e.g. with `afterFailure()` and `budgetCheck()`) actually correct?**
  _`Phase 2 — Workflow state machine + rules ✅ DONE (Session 15)` has 30 INFERRED edges - model-reasoned connections that need verification._
- **What connects `ws`, `@datylune/server`, `ws` to the rest of the system?**
  _4 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `services/workflow.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05696969696969697 - nodes in this community are weakly interconnected._
- **Why does `Phase 3 — Agent roles, prompts and output schemas ✅ DONE (Session 16)` connect `Phase 3 — Agent roles, prompts and output schemas ✅ DONE (Session 16)` to `agentOutputs.js`, `orchestrator.js`, `Part A — Company workflow`, `api`, `worker.js`, `workflowAgents.js`?**
  _High betweenness centrality (0.116) - this node is a cross-community bridge._
- **Should `agentOutputs.js` be split into smaller, more focused modules?**
  _Cohesion score 0.10276679841897234 - nodes in this community are weakly interconnected._
- **Why does `Implementation checklist` connect `DATYLUNE AI OS` to `[taskId]/page.jsx`, `api.test.js`, `orchestrator.js`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._