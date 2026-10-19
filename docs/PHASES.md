# DATYLUNE AI OS — Delivery phases

The roadmap for turning DATYLUNE into a working IT services company:

**Client → BA → CEO → PM → Team heads → Specialists → Review → QA → Delivery**

It has two parts:
- **Part A**: the company workflow, Phases 0–7.
- **Part B**: the Client Agent demo, Steps 0–7. It is built on top of Part A.

Rules for every phase:
- Inspect the code before changing it, and reuse existing patterns.
- Never delete user data.
- Never fabricate statuses or test results.
- Agents never approve, overspend, deploy or contact clients.

A phase is **DONE** only when its tests pass with real output, recorded in `IMPLEMENTATION_CHECKLIST.md`.

Status legend: ✅ DONE · 🔄 IN PROGRESS · ⏳ NOT STARTED · ⛔ BLOCKED

| # | Phase | Status | Checklist rows |
|---|---|---|---|
| 0 | Fix blockers | ✅ DONE | J-01 … J-05 |
| 1 | Data model | ✅ DONE | J-06, J-07 |
| 2 | Workflow state machine + rules | ✅ DONE | J-08, J-09 |
| 3 | Agent roles, prompts and output schemas | ✅ DONE | J-10, J-11, J-12 |
| 4 | API endpoints | ⏳ NOT STARTED | — |
| 5 | UI | ⏳ NOT STARTED | — |
| 6 | Data clean-up | ⏳ NOT STARTED | — |
| 7 | Testing (unit, integration, E2E, security, a11y) | ⏳ NOT STARTED | — |
| B | Client Agent demo (Steps 0–7) | ⛔ BLOCKED on Phases 1–5 | — |

## ▶ Start here next session (Phases 4 → 7)

**Ready:**
- Phases 0–3 are on `origin/claude/peaceful-wright-9nolwq`.
- Graphify is installed (`npm run graph:update`, then `graphify query "…"` or `python -m graphify query "…"`).
- The dark theme is in.

**Before coding:**
1. `npm run dev`. Check that the worker heartbeat is ONLINE on the Monitoring page.
2. Read this file and the `SESSION_HANDOFF.md` "Next" section.
3. Ask the graph, e.g. `graphify query "where are workflow services called?"`.

| Order | Phase | Files to create / change | Done when |
|---|---|---|---|
| 1 | **4 API** | `server/src/http/routes/workflow.js` (new router mounted from `routes/index.js`). Use `userActor(req.user, req.membership)` only; call `services/workflow.js` + `workflowAgents.advance()`. Map `WorkflowError.status/code` in the error handler (it already passes `code` and `details`). | `server/test/integration/workflowApi.test.js`:<br>• every endpoint in the Phase 4 table, with 403 for the wrong role;<br>• 404 for cross-org and cross-client;<br>• human-only endpoints refuse non-admins;<br>• `leaks()` = 0 absolute paths;<br>• worker offline → 409 `WORKER_OFFLINE` on endpoints that schedule agents. |
| 2 | **5 UI** | **Pages:**<br>• `web/app/requests/` (list + new) and `requests/[requestId]` (stepper + tabs)<br>• `web/app/work/` (Kanban)<br>• `work/[workItemId]`<br>• `web/app/deliverables/`<br><br>**Components:**<br>• `Stepper`<br>• shared `Brief` form<br>• `CeoDecision` panel<br>• shared status dictionary `web/lib/status.js` (replaces ad-hoc colours in `StatusBadge`)<br><br>**Nav and layout:**<br>• simplify the nav to about 12 items, with "Roadmap" for unbuilt pages<br>• mobile hamburger at ≤860 px; cards at ≤640 px | `next build` passes; browser check at 1440 px and 375 px in light **and** dark; no horizontal scroll; `aria-live` on status. |
| 3 | **6 Clean-up** | Extend `server/scripts/data-hygiene.js`: archive timestamped test projects ("Agent Chat Demo 1792…"); fix Sandbox client counts; the Requirements tab includes tasks from every entry point. | Dry-run output reviewed with the user before `--apply`; backup + audit rows. |
| 4 | **7 Tests** | Playwright (`web/e2e/`): request → BA → CEO approve → plan → board → deliverable, at 1440 and 375 px; axe scan of the new pages; security grep for absolute paths and tokens. | All green with real output pasted into the checklist. |
| 5 | **Part B** | Client Agent demo: ask the Step-0 questions **one at a time** first (folder, idea, personality, speed, client, budget). | See Part B below. |

---

## Part A — Company workflow

### Target flow (8 stages)

| Stage | Owner | Output | Status after | Gate |
|---|---|---|---|---|
| 1 Client request | Client (human or Client Agent) | ClientRequest | `NEW` | — |
| 2 BA analysis | business-analyst agent | RequirementSpec + questions + estimate | `ANALYSED` / `NEEDS_CLIENT_INFO` | BA recommends ACCEPT / NEED_INFO / REJECT (cannot approve) |
| 3 CEO decision | **Human** CEO/ORG_ADMIN (CEO agent only writes a brief) | CeoDecision (budget, priority, deadline) | `APPROVED` / `REJECTED` | Human approval, bound to the spec version's hash |
| 4 PM plan | project-manager agent | ProjectPlan (tasks, departments, dependencies) | `PLANNED` | — |
| 5 Assignment | Department heads (CTO, CPO, CISO…) | One named specialist per task | `ASSIGNED` | Head picks only from its own department |
| 6 Work | Specialist agent | Outputs + evidence in the project workspace | `IN_PROGRESS` → `SUBMITTED` | Dependencies must be DONE first |
| 7 Review + QA | Head, then QA agent | Review verdict + per-criterion QA results | `DONE` / `REWORK` | Evidence required; 3 failures → `BLOCKED` + human |
| 8 Delivery | PM compiles, **human** CEO approves | Deliverable report | `DELIVERED` | Human final approval |

---

### Phase 0 — Fix blockers ✅ DONE (Session 14)

**Goal:** make sure work can run safely before building the workflow on top.

| # | Item | Result |
|---|---|---|
| 0.1 | One execution path through the worker; explain why runs exist with no heartbeat | Only `queue/worker.js` calls `executeTask`. The old runs came from a worker built before heartbeats existed. Monitoring now shows the last run and a note. `npm run dev` starts web + API + worker. |
| 0.2 | Block dispatch when no worker is online on all entry points, with an explicit "Queue anyway" | 409 `WORKER_OFFLINE` on CEO execute, Tasks, Agent Chat and Retry. `queueAnyway: true` is audited. Workspace failures are never overridable. |
| 0.3 | Workspace isolation on project create/edit | Client required. No overlap or nesting with other projects, never inside the app tree. The folder must exist when `createFolder: false` (plain directory, no symlink). |
| 0.4 | Redact absolute paths in every API response, Audit Log included | One gate (`core/redact.js` `redactResponse`):<br>• roots → `<workspace>`<br>• other absolute paths → `<path>/name`<br>• home folders → `~`<br>Full roots are shown only on project settings, to workspace managers. |
| 0.5 | Auth token in an httpOnly cookie; investigate the 401s | Already an httpOnly SameSite=Strict cookie, with no token in storage or in `user`. Added sliding renewal, plus `GET /auth/session` so signed-out visits make no 401 request. |

**Evidence:**
- Unit tests 59/60. The one failure is the known Windows symlink EPERM test.
- Integration tests 7/7.
- Lint ok; `validate:claude` ok.
- `next build`: 25 routes.

**Remaining:** check "Queue anyway" in a browser (Chrome was unresponsive during the session).

---

### Phase 1 — Data model ✅ DONE (Session 15)

**Goal:** give every stage its own persisted record. Every record is scoped by `organizationId` and `clientId`, has timestamps, and records `createdBy`.

| Model | Key fields |
|---|---|
| **ClientRequest** | title, description, attachments[], clientId, projectId?, submittedBy, requested priority, desiredDeadline<br>status: `NEW · IN_ANALYSIS · NEEDS_CLIENT_INFO · ANALYSED · AWAITING_CEO · APPROVED · REJECTED · IN_DELIVERY · DELIVERED · CLOSED`<br>history[] (status, by, at, note)<br>source (`HUMAN` / `CLIENT_AGENT`), isDemo, demoScenarioId |
| **RequirementSpec** | requestId, version, hash, summary, businessGoal, targetUsers<br>scope (inScope[] / outOfScope[])<br>features[] (`MUST` / `SHOULD` / `COULD`)<br>acceptanceCriteria[] (featureId, criterion, testMethod — testable, never generic)<br>clarifyingQuestions[] (question, answer, answeredBy)<br>risks[], assumptions[]<br>estimate (hours, USD, days, departments)<br>baRecommendation + baReason |
| **CeoDecision** | requestId, specVersion, specHash<br>decision: `APPROVED · REJECTED · CHANGES_REQUESTED`<br>approvedBudgetUSD, priority P0–P3, deadline, notes<br>decidedBy (**human** CEO/ORG_ADMIN only), decidedAt |
| **ProjectPlan** | requestId, projectId, version<br>milestones[]<br>tasks[] (title, departmentId, requiredRole, dependsOn[], acceptanceCriteriaIds[], estimateHours, budgetUSD)<br>status: `DRAFT · ACTIVE · COMPLETED` |
| **WorkItem** | planTaskId, projectId, requestId, departmentId<br>assignedHead, assignedAgent, assignedBy, assignedAt<br>status: `PLANNED · ASSIGNED · QUEUED · IN_PROGRESS · SUBMITTED · IN_REVIEW · IN_QA · REWORK · DONE · BLOCKED · CANCELLED`<br>attempts (max 3)<br>outputs[], evidence[], reviews[], qaResults[]<br>tokens, costUSD, agentRunIds[] |
| **Deliverable** | requestId, projectId, items[] (from DONE work items), summaryReport<br>ceoFinalApproval (human), deliveredAt, clientAcknowledged |

**Deliverables:**
- The models in `server/src/models/index.js`.
- A **reversible migration with a backup** that maps existing Tasks to legacy WorkItems, or marks them legacy. Dry run by default; `--apply` to run it.

**Acceptance:**
- Indexes are tenant-scoped.
- The migration's dry run lists its changes.
- After `--apply`, a backup file exists and the old task pages still work.

**Result (Session 15):**

| Item | What was built |
|---|---|
| Models (`server/src/models/index.js`) | **ClientRequest** (incl. `source` / `isDemo` / `demoScenarioId` for Part B)<br>**RequirementSpec** (versioned, with a content hash)<br>**CeoDecision** (human only, bound to the spec hash)<br>**ProjectPlan** (versioned; an older draft becomes SUPERSEDED when replanned)<br>**WorkItem** (one per plan task; links its execution Tasks through `taskIds`)<br>**Deliverable**<br>**ClientFeedback**<br>Every record has `organizationId` + `clientId`, timestamps and `history[]`. |
| Task link | `Task.workItemId` and `Task.legacy` |
| Migration | `server/src/services/migrations/workflowV1.js`, run with `npm run migrate:workflow -w server [-- --apply \| --revert <file>]`<br>• dry run by default<br>• the backup is written **before** any change<br>• safe to re-run (idempotent), reversible and audited |
| **Migration run (dev DB)** | Dry run: 6 tasks to mark → `--apply`: 6 marked legacy.<br>Backup: `.data-backups/migrate-workflow-2026-10-19T17-18-26-649Z.json`<br>API health 200 afterwards. |

Tests (integration):
- "Phase 1: models…": org and client are required; spec versions are unique; client and project scoping; demo flag.
- "Phase 1: migration…": the dry run writes nothing; the backup comes before the write; workflow-linked tasks are untouched; re-running changes nothing; revert restores the old values, including removing a field that did not exist before.

---

### Phase 2 — Workflow state machine + rules ✅ DONE (Session 15)

**Goal:** one pure, fully unit-tested module (`server/src/core/workflow.js`) decides every transition.

Every transition checks:
- the allowed from-state;
- the actor's role;
- org and client scope;
- that the required data is present.

Every transition writes a redacted audit event and a history entry.

Rules:
- BA and PM cannot approve. Agents can never make CEO decisions or give final delivery approval.
- A WorkItem cannot start until all of its `dependsOn` items are DONE.
- REWORK returns to the **same** specialist, with review and QA comments injected into its prompt.
- After 3 failed attempts → `BLOCKED`, plus an item in the human Approvals inbox.
- Budget guard: when spent cost exceeds the approved budget, remaining items pause until the CEO approves continuing.
- No dispatch when the worker is offline (from Phase 0).

**Acceptance:** unit tests cover every allowed and forbidden transition, actor checks, the dependency gate, the rework limit and the budget guard.

**Result (Session 15):**

**Pure rules: `server/src/core/workflow.js`**

One gate, `checkTransition(entity, { record, to, actor, ctx })`, covers requests, plans, work items and deliverables. It checks, in order:
1. the allowed from-state;
2. org and client scope (404);
3. the actor (403);
4. the required data (422, or a specific code: `DEPENDENCIES_PENDING`, `BUDGET_EXCEEDED`, `WORKER_OFFLINE`, `STALE_SPEC`).

Helpers:
- `specHash`;
- `pendingDependencies` / `readyItems`;
- `afterFailure` (MAX_ATTEMPTS = 3);
- `budgetCheck`;
- `validatePlan` (cycles, unknown dependencies, departments, budget);
- `qaRequirements` (rejects "ok"-style evidence);
- `currentStage`.

**Service: `server/src/services/workflow.js`**

`move()` is the only code that writes a status: conditional update → history entry → redacted audit row `workflow.<entity>.<status>`.

| Stage | Operations |
|---|---|
| Request + BA | `createRequest`, `saveSpec` (BA only), `concludeAnalysis`, `answerQuestions` (each answer round is a new spec version) |
| CEO | `decideAsCeo` (human ORG_ADMIN / PLATFORM_OWNER only; refuses a stale spec), `raiseBudget` (human CEO) |
| PM | `savePlan`, `activatePlan` (creates WorkItems, assigns the department head, request → IN_DELIVERY) |
| Work | `assignWorkItem` (own department, specialists only), `dispatchReady` (dependencies DONE + worker online + within budget), `startWork`, `submitWork` (assigned specialist only) |
| Review / QA | `reviewWorkItem`, `qaWorkItem`, REWORK → BLOCKED after 3 failures with an Approvals-inbox escalation, `enforceBudget`, `unblockWorkItem` (human), `maybeCompletePlan` |
| Delivery | `compileDeliverable`, `approveDeliverable` (human CEO), `recordClientFeedback` (ACCEPT → CLOSED; CHANGES_REQUESTED → back to the BA), `timeline` |

Actors: the HTTP layer builds only user actors, from the session membership. Agent and system actors exist only inside services and the worker.

**Tests**

Unit (`test/unit/workflow.test.js`), 15/15:
- every allowed (transition, actor) pair passes;
- every other from→to pair is rejected;
- every rule refuses actors it doesn't permit, including agents that claim ORG_ADMIN;
- an empty context is refused;
- also covered: scope, BA NEED_INFO, binding to the spec hash, the dependency gate, worker offline, the rework limit, QA evidence, budget, plan validation, stages.

Integration (`test/integration/workflow.test.js`), 9/9, with mocked agents:
- happy path to DELIVERED + CLOSED, with the full timeline and audit trail;
- NEED_INFO → answers → re-analysis;
- CEO reject and request changes;
- QA fail → rework by the same specialist → pass;
- 3 review failures → BLOCKED + a PENDING escalation → human unblock;
- overspend → BUDGET_EXCEEDED pause → only the human CEO can raise the budget → unblock;
- worker offline holds dispatch;
- cross-org access gives 404;
- concurrent moves: only one wins;
- a change request after delivery goes back to the BA.

Left for later phases, by design:
- Phase 3 (✅ done in Session 16): agents actually writing specs, plans, reviews and QA results, and review/QA comments injected into the rework prompt.
- Phase 4: HTTP endpoints.
- Phase 5: UI.

---

### Phase 3 — Agent roles, prompts and output schemas ✅ DONE (Session 16)

**Goal:** every agent returns structured JSON validated with zod. Invalid output → one retry → `BLOCKED`.

| Agent | Input → Output | Hard rule |
|---|---|---|
| business-analyst (added to Product if missing) | ClientRequest → RequirementSpec | Vague request (e.g. "CREAT POTFLIO") → must ask questions and recommend NEED_INFO, never guess |
| founder-ceo (agent) | Spec → decision brief (summary, risks, recommended budget) | Only prepares; the decision is a human button |
| project-manager | Approved spec + decision → ProjectPlan | Tasks mapped to departments, roles and dependencies |
| Department heads (cto, cpo, vp-eng-ops, ciso, cdao, cmo, cro, cco, cfo, coo) | Task → assignment; submission → PASS/FAIL review | Assign only from their own department; give concrete comments |
| Specialists | WorkItem → outputs + evidence | Work only in the project workspace, only on their own task |
| qa-engineer / automation-test-engineer | Submission → per-criterion results | A verdict like "ok" without evidence is rejected by the schema |

**Acceptance:** the schema tests accept valid output and reject vague or empty output.

**Result (Session 16):**

**Roles**
- `business-analyst` added to Product (`catalog/organization.mjs` `workflowRoles`). It sits outside the 50-role table, like the Founder/CEO, and is read-only.
- Seeded into the dev DB (version 1). The seed now reports 161 + 1 workflow role, and re-running it changes nothing.
- `core/workflowSteps.js` binds each step to its agent, and checks that the agent may hold that role (`workflowRolesOf`):

| Step | Agent | Workflow role |
|---|---|---|
| `ba.analyse` | business-analyst | BA |
| `ceo.brief` | founder-ceo | CEO_AGENT (advice only) |
| `pm.plan` | project-manager | PM |
| `head.assign` | the item's department head | HEAD |
| `specialist.work` | the assigned agent | SPECIALIST |
| `head.review` | the item's department head | HEAD |
| `qa.verify` | qa-engineer | QA |
| `pm.deliverable` | project-manager | PM |

Legacy agents hold no workflow role. Each step has a spend cap; a specialist's cap is the task's plan budget.

**Prompts** (one builder per step)
- Client and agent text is wrapped in `<client_request>` / `<client_answers>` / `<work_output>` / `<agent_report>` tags and declared untrusted data. A closing tag inside client text is stripped.
- Every prompt ends with the exact JSON output contract and the rules for that step:
  - BA: a vague request must ask questions and recommend NEED_INFO;
  - PM: every acceptance criterion covered, no cycles, within budget;
  - QA: real evidence for each criterion.
- A retry includes the validation errors from the rejected reply.
- **Rework**: `reworkNotes()` puts the failed review comments and failed QA criteria with their evidence into the same specialist's next prompt.

**Output schemas** (`core/agentOutputs.js`, zod), one per step. They reject:
- generic criteria ("it works");
- "ok"-style evidence;
- NEED_INFO with no questions, or open questions with any other recommendation;
- unknown feature ids, or a MUST feature without a criterion;
- absolute paths, `..` or `~` in outputs;
- a PASS/FAIL verdict that doesn't match the per-criterion results;
- a CEO agent trying to "approve".

`extractJson` reads the last fenced JSON block or the last balanced object.

**Execution** (`services/workflowAgents.js`)
- Each step is an ordinary queued Task (`kind: 'workflow'`, `Task.workflow` = step / record / agent / attempt / outcome / issues). It reuses the worker, budgets, path guard, events and redaction.
- `scheduleStep` refuses to queue when:
  - no worker is online (`WORKER_OFFLINE`);
  - there's no project workspace;
  - the agent is missing or can't hold the role.

  It is idempotent per step, record, version and attempt.
- Worker hooks:
  - `beforeWorkflowTask` moves the specialist's item to IN_PROGRESS;
  - `afterWorkflowTask` parses and validates the reply, then applies it through `services/workflow.js`.
- Checks beyond the schema:
  - every claimed output file must exist inside the workspace (path guard; no traversal or symlink escape);
  - a plan's departments, roles and criterion ids must exist, and every criterion must be covered;
  - a head may assign only from its own department.
- Invalid output → one retry with the errors → then:
  - a work item becomes BLOCKED (`INVALID_OUTPUT`) with an Approvals-inbox escalation;
  - a failed BA analysis returns the request to NEW and escalates.
- Each item's step costs are charged to that item, so the budget guard sees them.
- `advance()` schedules whatever the records say comes next:
  - IN_ANALYSIS → BA;
  - AWAITING_CEO → CEO brief;
  - APPROVED → PM plan;
  - IN_DELIVERY → head assignment, dispatch of ready items, review, QA, then the PM's deliverable once everything is DONE.
- Human gates stay human: the CEO decision, plan activation, final delivery approval and unblocking.

**Tests**

Unit (`agentOutputs.test.js`), 8/8: JSON extraction; a schema and prompt for every step; BA, specialist, QA/review, PM, CEO, assignment and deliverable validation; role binding; prompt injection fenced; rework comments injected.

Integration (`workflowAgents.test.js`), 3/3. These use the real `processTask` → `executeTask` path with only the Claude CLI scripted; the scripted specialists write real files.
1. "CREAT POTFLIO" goes through the whole company:
   - the BA asks a question → the client answers → the BA sends an invalid reply → the retry includes the errors → valid spec;
   - the CEO agent writes a brief but no decision → the human approves;
   - the PM plans → a human activates → the CTO agent assigns;
   - the specialists write `server.js` and `index.html`;
   - review → QA FAIL → rework, with the QA comment in the prompt → PASS;
   - `web` waits for `api` → the PM writes the deliverable → the human approves → DELIVERED.

   Every step is processed and audited.
2. An out-of-department pick is rejected and retried. A specialist claiming a file it never wrote is retried, then BLOCKED with an escalation.
3. A BA that's invalid twice → the request returns to NEW with an escalation. Worker offline → nothing is queued. No project → no agent runs. Another org → not found.

Not covered here:
- triggering these steps from the API and UI (Phases 4–5);
- a live run against real Claude Code, which happens once the worker is running.

---

### Phase 4 — API endpoints ⏳

All endpoints sit under `/api/v1/orgs/:orgId`. Each one has:
- auth and org membership checks;
- client scoping;
- role checks;
- zod validation;
- path redaction;
- audit events;
- the consistent error format.

| Area | Endpoints |
|---|---|
| Requests | `POST /requests` · `GET /requests` · `GET /requests/:id` · `GET /requests/:id/timeline` |
| BA | `POST /requests/:id/analyse` · `POST /requests/:id/answers` |
| CEO | `POST /requests/:id/ceo-decision` (human only) |
| PM | `POST /requests/:id/plan` · `POST /plans/:id/activate` |
| Work | `POST /work-items/:id/assign` · `/review` · `/qa` · `/rework` · `/cancel` · `/retry` |
| Delivery | `POST /requests/:id/deliverable/compile` · `POST /deliverables/:id/approve` (human only) |

**Acceptance:** integration tests, including cross-org and cross-client access denied (403/404), and agents refused on human-only endpoints.

---

### Phase 5 — UI ⏳

Keep the current design system.

| # | Screen | Contents |
|---|---|---|
| 5.1 | Navigation (~12 items) | Home · Requests · Approvals · Projects · Work Board · Deliverables · Company · Governance · Settings, with "Roadmap" for unbuilt pages<br>Mobile: hamburger and off-canvas sidebar at ≤860 px; tables become cards at ≤640 px; no horizontal scroll |
| 5.2 | Requests | List with stage chips; "New request" form |
| 5.3 | Request detail | Stage stepper: Request → BA → CEO → PM → Assignment → Work → Review/QA → Delivery<br>Tabs: Overview · Requirements · Plan · Work Items · Deliverables · Timeline |
| 5.4 | CEO Decision | Spec summary, estimate, risks, CEO brief<br>Buttons: Approve (budget, priority, deadline) · Request changes · Reject. Also shown in the Approvals inbox |
| 5.5 | Work Board (Kanban) | Columns PLANNED → BLOCKED<br>Cards show head, assigned agent, attempts and cost; filters |
| 5.6 | Work Item detail | Assignment, outputs, evidence, reviews, QA per criterion, rework history, runs<br>Human actions: Retry / Cancel / Reassign |
| 5.7 | Org Chart workload | Active, in-review and rework counts per head and per agent |
| 5.8 | Deliverables | Per project and per client; report, files, CEO final approval, delivered status |
| 5.9 | Shared Brief component | Reused everywhere; one USD budget field; disabled with a reason when the project is not ready |
| 5.10 | Status consistency | One shared status dictionary and colours; `?tab=` kept in the URL; live connections closed for finished items; `aria-live` on status changes |

**Acceptance:**
- `next build` passes.
- Browser check at 1440 px and 375 px with no horizontal scroll.
- No console errors.

---

### Phase 6 — Data clean-up ⏳

- A script that renames or archives timestamped test projects (e.g. "Agent Chat Demo 1792412210443"). Dry run by default; `--apply` takes a backup and audits each change.
- Fix label mismatches:
  - archived projects;
  - Sandbox client counts;
  - the Requirements tab must include tasks from all entry points.

**Acceptance:** the dry-run output is reviewed, and `--apply` leaves a backup plus audit rows.

---

### Phase 7 — Testing (must pass before "done") ⏳

| Type | Coverage |
|---|---|
| Unit | State machine (every transition), schemas, redaction, budget guard, rework limit |
| Integration (mocked agents) | Happy path to DELIVERED; QA fail → rework → pass; NEED_INFO; CEO reject; worker offline blocks dispatch; cross-org and cross-client 403/404 |
| E2E (Playwright) | Create request → BA spec → CEO approve → plan → board shows agents → deliverable approved, at 1440 px and 375 px, asserting no horizontal scroll |
| Security | 0 absolute paths in API responses (started in Phase 0); no token in localStorage |
| Accessibility | axe scan with 0 serious issues on the new pages |

---

## Part B — Client Agent demo ⛔ (needs Phases 1–5)

A simulated client that writes a proposal and goes through the **normal** request flow with no shortcuts. It answers the BA's questions, waits for the **human** CEO, reviews the deliverable, then accepts it or asks for changes. Real files are written to a local folder that you confirm.

| Step | What | Key rules |
|---|---|---|
| 0 | Ask the setup questions one at a time:<br>Q1 workspace folder · Q2 project idea · Q3 client personality · Q4 speed mode · Q5 owning client · Q6 budget | Never guess paths. Validate the folder: exists, not inside the app, no overlap. Confirm "yes/no". Save as a DemoScenario. |
| 1 | `client-agent` role, in an "External / Simulated Client" group | Cannot approve, assign, or see prompts, costs or other clients. Badge "SIMULATED CLIENT — DEMO". Prompts: `proposal.md`, `answer-questions.md`, `review-delivery.md` (JSON + schema). |
| 2 | Data | DemoScenario (hidden true requirements visible only to the agent and admins); ClientRequest `source` / `isDemo`; ClientFeedback |
| 3 | Flow | Proposal → BA → client answers → CEO (human banner "Waiting for CEO (you)") → PM → heads → specialists → review/QA → deliverable → CEO final approval → client review → ACCEPT (DELIVERED + CLOSED) or CHANGES_REQUESTED (back to BA) |
| 4 | Local files | Only the worker writes, only inside the confirmed path (traversal and symlink checks). Worker offline → stop with "Start the worker with npm run dev". Output: project files + README.md + DELIVERY_REPORT.md. |
| 5 | UI | **Demo Studio** wizard (admin only)<br>Live view: stage stepper, client conversation, company activity, Next / Pause / Approve as CEO / Stop, cost vs budget bar<br>Purple "DEMO CLIENT" badge |
| 6 | Safety | No real emails or contacts. Demo data hidden by default ("Show demo data" toggle). Reset deletes only demo records, after confirmation, and never files without asking. Budget respected; Fast mode costs nothing. |
| 7 | Tests | Unit: permissions, schemas, path validation<br>Integration: Fast-mode full run, vague → NEEDS_CLIENT_INFO, strict → rework, worker offline<br>Playwright at 1440 / 375 px<br>Real directory listing of the created files |

---

## Report required after each phase

1. Files changed and why
2. Migrations run
3. Tests added, with real output
4. UI screenshots or a description
5. Known limitations and what remains
6. Self-score out of 10 per area (backend, security, UX, QA, frontend), with evidence

Then update this file's status table, the checklist rows and `SESSION_HANDOFF.md`.
