import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RULES, REQUEST_STATES, PLAN_STATES, WORK_ITEM_STATES, DELIVERABLE_STATES, MAX_ATTEMPTS,
  checkTransition, allowedTransitions, specHash, afterFailure, budgetCheck, validatePlan, findCycle,
  pendingDependencies, readyItems, qaRequirements, currentStage, canDecide, WorkflowError,
} from '../../src/core/workflow.js';

const ORG = 'org-1';
const CLIENT = 'client-1';
const ACTORS = {
  system: { kind: 'system', organizationId: ORG },
  operator: { kind: 'user', id: 'u-op', organizationId: ORG, role: 'AGENT_OPERATOR' },
  manager: { kind: 'user', id: 'u-pm', organizationId: ORG, role: 'PROJECT_MANAGER' },
  decider: { kind: 'user', id: 'u-ceo', organizationId: ORG, role: 'ORG_ADMIN' },
  ba: { kind: 'agent', slug: 'business-analyst', organizationId: ORG, workflowRole: 'BA' },
  pm: { kind: 'agent', slug: 'project-manager', organizationId: ORG, workflowRole: 'PM' },
  head: { kind: 'agent', slug: 'cto', organizationId: ORG, workflowRole: 'HEAD', departmentSlug: 'eng' },
  specialist: { kind: 'agent', slug: 'frontend-engineer', organizationId: ORG, workflowRole: 'SPECIALIST', departmentSlug: 'eng' },
  qa: { kind: 'agent', slug: 'qa-engineer', organizationId: ORG, workflowRole: 'QA' },
  client: { kind: 'agent', slug: 'client-agent', organizationId: ORG, workflowRole: 'CLIENT', clientId: CLIENT },
};
// Agents that are never allowed to act as a human, whatever they claim.
const IMPOSTORS = [
  { kind: 'agent', slug: 'founder-ceo', organizationId: ORG, workflowRole: 'CEO_AGENT', role: 'ORG_ADMIN' },
  { kind: 'agent', slug: 'x', organizationId: ORG, role: 'PLATFORM_OWNER' },
];

const spec = {
  requestId: 'r1', version: 1, summary: 'Portfolio site', businessGoal: 'get clients', targetUsers: ['recruiters'],
  scope: { inScope: ['home page'], outOfScope: ['blog'] },
  features: [{ id: 'F-1', title: 'Home', description: 'hero + projects', priority: 'MUST' }],
  acceptanceCriteria: [{ id: 'AC-1', featureId: 'F-1', criterion: 'index.html renders 3 project cards', testMethod: 'open in browser + DOM check' }],
  clarifyingQuestions: [{ id: 'Q-1', question: 'Colours?', answer: 'navy' }],
  risks: [], assumptions: [], estimate: { effortHours: 4, costUSD: 2, durationDays: 1, departmentsNeeded: ['eng'] },
  baRecommendation: 'ACCEPT', baReason: 'clear',
};
const qaPass = { verdict: 'PASS', criteriaResults: [{ criterionId: 'AC-1', pass: true, evidence: 'npm test: 12 passing, 0 failing' }] };
const qaFail = { verdict: 'FAIL', criteriaResults: [{ criterionId: 'AC-1', pass: false, evidence: 'only 2 of 3 project cards render (DOM check)' }] };
const planRecord = (status) => ({ status, organizationId: ORG, clientId: CLIENT, tasks: [{ id: 't1', departmentSlug: 'eng', requiredRole: 'frontend-engineer', dependsOn: [], budgetUSD: 2 }] });

const BASE_CTX = {
  spec,
  decision: { decision: 'APPROVED', approvedBudgetUSD: 10, priority: 'P1', deadline: new Date('2026-12-01'), notes: 'go', specHash: specHash(spec) },
  plan: { status: 'ACTIVE' },
  request: { status: 'APPROVED', clientId: CLIENT },
  deliverable: { items: [{ title: 'site' }], summaryReport: 'Built the site.', ceoFinalApproval: { approved: true } },
  feedback: { verdict: 'CHANGES_REQUESTED', comments: ['Add a contact form'] },
  agent: { slug: 'frontend-engineer', departmentSlug: 'eng', kind: 'CORE_ROLE' },
  siblings: [], workerOnline: true, budget: { ok: true }, budgetApproved: true,
  submission: { outputs: [{ type: 'file', path: '<workspace>/index.html' }], evidence: [{ type: 'test', content: '12 passing' }] },
  review: { verdict: 'PASS', comments: ['Matches AC-1'] },
  qa: qaPass,
  items: [{ status: 'DONE' }],
  reason: 'INVALID_OUTPUT',
  note: 'withdrawn by client',
};
const OVERRIDES = {
  'request:IN_ANALYSIS>NEEDS_CLIENT_INFO': { spec: { ...spec, baRecommendation: 'NEED_INFO', clarifyingQuestions: [{ id: 'Q-1', question: 'Colours?' }] } },
  'request:AWAITING_CEO>REJECTED': { decision: { decision: 'REJECTED' } },
  'request:AWAITING_CEO>IN_ANALYSIS': { decision: { decision: 'CHANGES_REQUESTED', notes: 'cut scope' } },
  'workItem:IN_REVIEW>REWORK': { review: { verdict: 'FAIL', comments: ['Cards missing alt text'] } },
  'workItem:IN_QA>REWORK': { qa: qaFail },
};
const RECORDS = {
  request: (status) => ({ status, organizationId: ORG, clientId: CLIENT }),
  plan: planRecord,
  workItem: (status) => ({ status, organizationId: ORG, clientId: CLIENT, departmentSlug: 'eng', assignedAgent: 'frontend-engineer', attempts: 0, dependsOn: [], acceptanceCriteriaIds: ['AC-1'], blockedReason: null }),
  deliverable: (status) => ({ status, organizationId: ORG, clientId: CLIENT, items: [{ title: 'site' }], summaryReport: 'Built the site.' }),
};
const STATES = { request: REQUEST_STATES, plan: PLAN_STATES, workItem: WORK_ITEM_STATES, deliverable: DELIVERABLE_STATES };
const ctxFor = (entity, key) => ({ ...BASE_CTX, ...(OVERRIDES[`${entity}:${key}`] || {}) });

test('every allowed transition passes for each permitted actor with complete data', () => {
  let n = 0;
  for (const [entity, rules] of Object.entries(RULES)) {
    for (const [key, rule] of Object.entries(rules)) {
      const [from, to] = key.split('>');
      for (const who of rule.who) {
        assert.deepEqual(checkTransition(entity, { record: RECORDS[entity](from), to, actor: ACTORS[who], ctx: ctxFor(entity, key) }), { from, to }, `${entity} ${key} by ${who}`);
        n++;
      }
    }
  }
  assert.ok(n > 60, `checked ${n} allowed (transition, actor) pairs`);
});

test('every transition not in the rules is rejected as INVALID_TRANSITION', () => {
  let n = 0;
  for (const [entity, states] of Object.entries(STATES)) {
    for (const from of states) {
      for (const to of states) {
        if (RULES[entity][`${from}>${to}`]) continue;
        assert.throws(() => checkTransition(entity, { record: RECORDS[entity](from), to, actor: ACTORS.decider, ctx: BASE_CTX }), (e) => e.code === 'INVALID_TRANSITION', `${entity} ${from}>${to}`);
        n++;
      }
    }
  }
  assert.ok(n > 200, `checked ${n} forbidden transitions`);
  // Terminal states have no way out.
  assert.deepEqual(allowedTransitions('request', 'CLOSED'), []);
  assert.deepEqual(allowedTransitions('workItem', 'DONE'), []);
  assert.deepEqual(allowedTransitions('workItem', 'CANCELLED'), []);
});

test('every transition rejects actors that are not permitted (FORBIDDEN_ACTOR)', () => {
  for (const [entity, rules] of Object.entries(RULES)) {
    for (const [key, rule] of Object.entries(rules)) {
      const [from, to] = key.split('>');
      const permitted = new Set(rule.who);
      // A manager/decider/operator role check is hierarchical (an admin can do
      // what an operator can), so only test actors none of the rules admit.
      const admitted = (a) => rule.who.some((w) => checkWho(entity, from, to, a, key, w));
      for (const [name, actor] of [...Object.entries(ACTORS), ...IMPOSTORS.map((a, i) => [`impostor${i}`, a])]) {
        if (permitted.has(name) || admitted(actor)) continue;
        assert.throws(() => checkTransition(entity, { record: RECORDS[entity](from), to, actor, ctx: ctxFor(entity, key) }), (e) => e.code === 'FORBIDDEN_ACTOR', `${entity} ${key} must refuse ${name}`);
      }
    }
  }
});
function checkWho(entity, from, to, actor, key) {
  try { checkTransition(entity, { record: RECORDS[entity](from), to, actor, ctx: ctxFor(entity, key) }); return true; } catch (e) { return e.code !== 'FORBIDDEN_ACTOR'; }
}

test('agents can never make CEO or final delivery decisions', () => {
  const ceoMoves = [['request', 'AWAITING_CEO', 'APPROVED'], ['request', 'AWAITING_CEO', 'REJECTED'], ['request', 'IN_DELIVERY', 'DELIVERED'], ['deliverable', 'AWAITING_CEO', 'APPROVED']];
  for (const agent of [ACTORS.ba, ACTORS.pm, ACTORS.head, ACTORS.qa, ACTORS.client, ...IMPOSTORS]) {
    assert.equal(canDecide(agent), false);
    for (const [entity, from, to] of ceoMoves) {
      assert.throws(() => checkTransition(entity, { record: RECORDS[entity](from), to, actor: agent, ctx: BASE_CTX }), (e) => e.code === 'FORBIDDEN_ACTOR', `${agent.slug} ${from}>${to}`);
    }
  }
  // Non-admin humans cannot either.
  for (const role of ['PROJECT_MANAGER', 'AGENT_OPERATOR', 'REVIEWER', 'VIEWER']) {
    assert.throws(() => checkTransition('request', { record: RECORDS.request('AWAITING_CEO'), to: 'APPROVED', actor: { kind: 'user', id: 'u', organizationId: ORG, role }, ctx: BASE_CTX }), (e) => e.code === 'FORBIDDEN_ACTOR');
  }
  // BA recommends; it cannot approve or reject a request.
  assert.throws(() => checkTransition('request', { record: RECORDS.request('ANALYSED'), to: 'APPROVED', actor: ACTORS.ba, ctx: BASE_CTX }), (e) => e.code === 'INVALID_TRANSITION');
});

test('scope: other organizations and other clients are not found', () => {
  const other = { ...ACTORS.decider, organizationId: 'org-2' };
  assert.throws(() => checkTransition('request', { record: RECORDS.request('AWAITING_CEO'), to: 'APPROVED', actor: other, ctx: BASE_CTX }), (e) => e.code === 'SCOPE_DENIED' && e.status === 404);
  const otherClient = { ...ACTORS.client, clientId: 'client-2' };
  assert.throws(() => checkTransition('request', { record: RECORDS.request('NEEDS_CLIENT_INFO'), to: 'IN_ANALYSIS', actor: otherClient, ctx: BASE_CTX }), (e) => e.code === 'SCOPE_DENIED');
  assert.throws(() => checkTransition('request', { record: RECORDS.request('NEW'), to: 'IN_ANALYSIS', actor: undefined }), (e) => e.code === 'SCOPE_DENIED');
});

test('required data: each rule with requirements refuses an empty context', () => {
  let n = 0;
  for (const [entity, rules] of Object.entries(RULES)) {
    for (const [key, rule] of Object.entries(rules)) {
      if (!rule.requires) continue;
      const [from, to] = key.split('>');
      const actor = ACTORS[rule.who[0]];
      // The deliverable rules read the record itself, so strip its content too.
      // Unblocking only needs data when the block was a budget block.
      const budgetBlock = entity === 'workItem' && from === 'BLOCKED' ? { blockedReason: 'BUDGET_EXCEEDED' } : {};
      const record = entity === 'deliverable' ? { status: from, organizationId: ORG, clientId: CLIENT } : entity === 'plan' ? { ...planRecord(from), tasks: [] } : { ...RECORDS[entity](from), ...budgetBlock };
      // A client acting on a deliverable is identified through its request.
      const ctx = entity === 'deliverable' ? { request: { clientId: CLIENT } } : {};
      assert.throws(() => checkTransition(entity, { record, to, actor, ctx }), (e) => e instanceof WorkflowError && e.code !== 'FORBIDDEN_ACTOR' && e.code !== 'INVALID_TRANSITION' && e.details?.missing?.length > 0, `${entity} ${key}`);
      n++;
    }
  }
  assert.ok(n > 25, `checked ${n} rules with requirements`);
});

test('BA: vague requests must ask, and ANALYSED needs every question answered', () => {
  const vague = { ...spec, baRecommendation: 'NEED_INFO', clarifyingQuestions: [{ id: 'Q-1', question: 'What should the portfolio show?' }] };
  assert.throws(() => checkTransition('request', { record: RECORDS.request('IN_ANALYSIS'), to: 'ANALYSED', actor: ACTORS.ba, ctx: { spec: vague } }), /NEED_INFO goes to NEEDS_CLIENT_INFO/);
  assert.throws(() => checkTransition('request', { record: RECORDS.request('IN_ANALYSIS'), to: 'NEEDS_CLIENT_INFO', actor: ACTORS.ba, ctx: { spec: { ...vague, clarifyingQuestions: [] } } }), /unanswered clarifying question/);
  assert.throws(() => checkTransition('request', { record: RECORDS.request('NEEDS_CLIENT_INFO'), to: 'IN_ANALYSIS', actor: ACTORS.client, ctx: { spec: vague } }), /every clarifying question needs an answer/);
  assert.throws(() => checkTransition('request', { record: RECORDS.request('IN_ANALYSIS'), to: 'ANALYSED', actor: ACTORS.ba, ctx: { spec: { ...spec, acceptanceCriteria: [] } } }), /complete RequirementSpec/);
});

test('CEO approval is bound to the exact spec version', () => {
  const changed = { ...spec, features: [...spec.features, { id: 'F-2', title: 'Blog', priority: 'COULD' }] };
  assert.notEqual(specHash(changed), specHash(spec));
  assert.equal(specHash({ ...spec, _id: 'x', createdAt: new Date() }), specHash(spec), 'ids/timestamps are not content');
  assert.equal(specHash({ ...spec, clarifyingQuestions: [{ id: 'Q-1', question: 'Colours?', answer: 'navy', answeredBy: { kind: 'user' }, answeredAt: new Date() }] }), specHash(spec));
  assert.throws(() => checkTransition('request', { record: RECORDS.request('AWAITING_CEO'), to: 'APPROVED', actor: ACTORS.decider, ctx: { ...BASE_CTX, spec: changed } }), (e) => e.code === 'STALE_SPEC');
  assert.throws(() => checkTransition('request', { record: RECORDS.request('AWAITING_CEO'), to: 'APPROVED', actor: ACTORS.decider, ctx: { ...BASE_CTX, decision: { ...BASE_CTX.decision, approvedBudgetUSD: 0 } } }), /approved budget/);
});

test('dependency gate: an item starts only when every dependency is DONE', () => {
  const items = [
    { planTaskId: 'design', status: 'DONE' },
    { planTaskId: 'api', status: 'IN_QA' },
    { planTaskId: 'web', status: 'ASSIGNED', assignedAgent: 'frontend-engineer', dependsOn: ['design', 'api'] },
    { planTaskId: 'docs', status: 'ASSIGNED', assignedAgent: 'technical-writer', dependsOn: ['design'] },
  ];
  assert.deepEqual(pendingDependencies(items[2], items), ['api']);
  assert.deepEqual(readyItems(items).map((i) => i.planTaskId), ['docs']);
  const web = { ...RECORDS.workItem('ASSIGNED'), dependsOn: ['design', 'api'] };
  assert.throws(() => checkTransition('workItem', { record: web, to: 'QUEUED', actor: ACTORS.system, ctx: { ...BASE_CTX, siblings: items } }), (e) => e.code === 'DEPENDENCIES_PENDING' && /api/.test(e.message));
  items[1].status = 'DONE';
  assert.deepEqual(checkTransition('workItem', { record: web, to: 'QUEUED', actor: ACTORS.system, ctx: { ...BASE_CTX, siblings: items } }), { from: 'ASSIGNED', to: 'QUEUED' });
});

test('no dispatch while the worker is offline', () => {
  assert.throws(() => checkTransition('workItem', { record: RECORDS.workItem('ASSIGNED'), to: 'QUEUED', actor: ACTORS.system, ctx: { ...BASE_CTX, workerOnline: false } }), (e) => e.code === 'WORKER_OFFLINE');
  assert.throws(() => checkTransition('workItem', { record: RECORDS.workItem('REWORK'), to: 'QUEUED', actor: ACTORS.system, ctx: { ...BASE_CTX, workerOnline: false } }), (e) => e.code === 'WORKER_OFFLINE');
});

test('rework limit: REWORK twice, BLOCKED on the third failure; rework keeps the same specialist', () => {
  assert.equal(MAX_ATTEMPTS, 3);
  assert.deepEqual(afterFailure({ attempts: 0 }), { attempts: 1, to: 'REWORK', blockedReason: null });
  assert.deepEqual(afterFailure({ attempts: 1 }), { attempts: 2, to: 'REWORK', blockedReason: null });
  assert.deepEqual(afterFailure({ attempts: 2 }), { attempts: 3, to: 'BLOCKED', blockedReason: 'ATTEMPT_LIMIT' });
  assert.throws(() => checkTransition('workItem', { record: { ...RECORDS.workItem('REWORK'), attempts: 3 }, to: 'QUEUED', actor: ACTORS.system, ctx: BASE_CTX }), /attempt limit/);
  // Only the assigned specialist may submit.
  assert.throws(() => checkTransition('workItem', { record: RECORDS.workItem('IN_PROGRESS'), to: 'SUBMITTED', actor: { ...ACTORS.specialist, slug: 'backend-engineer' }, ctx: BASE_CTX }), (e) => e.code === 'FORBIDDEN_ACTOR');
  // A head reviews only its own department.
  assert.throws(() => checkTransition('workItem', { record: RECORDS.workItem('IN_REVIEW'), to: 'IN_QA', actor: { ...ACTORS.head, slug: 'cmo', departmentSlug: 'marketing' }, ctx: BASE_CTX }), (e) => e.code === 'FORBIDDEN_ACTOR');
  // A head assigns only from its own department, and only specialists.
  assert.throws(() => checkTransition('workItem', { record: RECORDS.workItem('PLANNED'), to: 'ASSIGNED', actor: ACTORS.head, ctx: { agent: { slug: 'seo-specialist', departmentSlug: 'marketing' } } }), /department/);
  assert.throws(() => checkTransition('workItem', { record: RECORDS.workItem('PLANNED'), to: 'ASSIGNED', actor: ACTORS.head, ctx: { agent: { slug: 'cto', departmentSlug: 'eng', kind: 'DEPARTMENT_HEAD' } } }), /not a head/);
  // A FAIL review needs concrete comments.
  assert.throws(() => checkTransition('workItem', { record: RECORDS.workItem('IN_REVIEW'), to: 'REWORK', actor: ACTORS.head, ctx: { review: { verdict: 'FAIL', comments: ['  '] } } }), /concrete comments/);
});

test('QA: a verdict without real per-criterion evidence is invalid', () => {
  const item = RECORDS.workItem('IN_QA');
  assert.deepEqual(qaRequirements(qaPass, item, 'PASS').filter(Boolean), []);
  for (const evidence of ['ok', 'OK.', 'passed', 'lgtm', '', 'fine']) {
    const missing = qaRequirements({ verdict: 'PASS', criteriaResults: [{ criterionId: 'AC-1', pass: true, evidence }] }, item, 'PASS').filter(Boolean);
    assert.ok(missing.some((m) => m.startsWith('real evidence')), `"${evidence}" must be rejected`);
  }
  assert.ok(qaRequirements({ verdict: 'PASS', criteriaResults: [] }, item, 'PASS').filter(Boolean).some((m) => /result for AC-1/.test(m)));
  assert.ok(qaRequirements({ verdict: 'PASS', criteriaResults: [{ criterionId: 'AC-1', pass: false, evidence: 'only two of three cards' }] }, item, 'PASS').filter(Boolean).includes('every criterion passed'));
  assert.throws(() => checkTransition('workItem', { record: item, to: 'DONE', actor: ACTORS.qa, ctx: { qa: { verdict: 'PASS', criteriaResults: [{ criterionId: 'AC-1', pass: true, evidence: 'ok' }] } } }), (e) => e.code === 'MISSING_DATA');
});

test('budget guard', () => {
  assert.deepEqual(budgetCheck({ approvedBudgetUSD: 5, spentUSD: 2, nextEstimateUSD: 1 }), { ok: true, remainingUSD: 3 });
  assert.equal(budgetCheck({ approvedBudgetUSD: 5, spentUSD: 5.01 }).ok, false);
  assert.equal(budgetCheck({ approvedBudgetUSD: 5, spentUSD: 4, nextEstimateUSD: 2 }).ok, false);
  assert.equal(budgetCheck({ approvedBudgetUSD: 0 }).ok, false, 'no approved budget → nothing is dispatched');
  assert.throws(() => checkTransition('workItem', { record: RECORDS.workItem('ASSIGNED'), to: 'QUEUED', actor: ACTORS.system, ctx: { ...BASE_CTX, budget: budgetCheck({ approvedBudgetUSD: 1, spentUSD: 2 }) } }), (e) => e.code === 'BUDGET_EXCEEDED');
  // A budget block can only be lifted once the budget is back in range.
  const blocked = { ...RECORDS.workItem('BLOCKED'), blockedReason: 'BUDGET_EXCEEDED' };
  assert.throws(() => checkTransition('workItem', { record: blocked, to: 'ASSIGNED', actor: ACTORS.manager, ctx: { budgetApproved: false } }), (e) => e.code === 'BUDGET_EXCEEDED');
  assert.deepEqual(checkTransition('workItem', { record: blocked, to: 'ASSIGNED', actor: ACTORS.manager, ctx: { budgetApproved: true } }), { from: 'BLOCKED', to: 'ASSIGNED' });
});

test('plan validation: dependencies, cycles, departments and budget', () => {
  const ok = { tasks: [{ id: 'a', departmentSlug: 'eng', requiredRole: 'x', budgetUSD: 1 }, { id: 'b', departmentSlug: 'eng', requiredRole: 'y', dependsOn: ['a'], budgetUSD: 1 }] };
  assert.deepEqual(validatePlan(ok, { approvedBudgetUSD: 5 }), []);
  assert.deepEqual(findCycle([{ id: 'a', dependsOn: ['c'] }, { id: 'b', dependsOn: ['a'] }, { id: 'c', dependsOn: ['b'] }]), ['a', 'c', 'b', 'a']);
  const bad = validatePlan({ tasks: [{ id: 'a', dependsOn: ['zz'], budgetUSD: 9 }, { id: 'a' }] }, { approvedBudgetUSD: 5 });
  for (const re of [/duplicate plan task id a/, /needs a department/, /needs a required role/, /unknown task zz/, /exceeds the approved/]) assert.ok(bad.some((m) => re.test(m)), String(re));
  assert.throws(() => checkTransition('plan', { record: planRecord('DRAFT'), to: 'ACTIVE', actor: ACTORS.decider, ctx: { request: { status: 'AWAITING_CEO' }, decision: BASE_CTX.decision } }), /must be APPROVED/);
  assert.throws(() => checkTransition('plan', { record: planRecord('DRAFT'), to: 'ACTIVE', actor: ACTORS.pm, ctx: BASE_CTX }), (e) => e.code === 'FORBIDDEN_ACTOR', 'the PM plans but cannot activate (approve) its own plan');
});

test('stage stepper follows the records', () => {
  assert.equal(currentStage({ request: { status: 'NEW' } }), 'REQUEST');
  assert.equal(currentStage({ request: { status: 'NEEDS_CLIENT_INFO' } }), 'BA_ANALYSIS');
  assert.equal(currentStage({ request: { status: 'AWAITING_CEO' } }), 'CEO_DECISION');
  assert.equal(currentStage({ request: { status: 'APPROVED' } }), 'PM_PLAN');
  assert.equal(currentStage({ request: { status: 'IN_DELIVERY' }, items: [{ status: 'PLANNED' }] }), 'ASSIGNMENT');
  assert.equal(currentStage({ request: { status: 'IN_DELIVERY' }, items: [{ status: 'IN_PROGRESS' }, { status: 'DONE' }] }), 'WORK');
  assert.equal(currentStage({ request: { status: 'IN_DELIVERY' }, items: [{ status: 'IN_QA' }, { status: 'DONE' }] }), 'REVIEW_QA');
  assert.equal(currentStage({ request: { status: 'DELIVERED' } }), 'DELIVERY');
});
