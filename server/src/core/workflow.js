// IT-company delivery workflow: Client request → BA → CEO → PM → heads →
// specialists → review → QA → delivery. Pure logic only (no DB): every
// transition is checked for (1) an allowed from-state, (2) the actor, (3)
// tenant/client scope and (4) the data it needs. Services apply the result,
// write history and audit. Agents can never make CEO or delivery decisions.
import { payloadHash } from './canonical.js';
import { hasPermission, PERMISSIONS } from './permissions.js';

export const REQUEST_STATES = Object.freeze([
  'NEW', 'IN_ANALYSIS', 'NEEDS_CLIENT_INFO', 'ANALYSED', 'AWAITING_CEO',
  'APPROVED', 'REJECTED', 'IN_DELIVERY', 'DELIVERED', 'CLOSED',
]);
export const PLAN_STATES = Object.freeze(['DRAFT', 'ACTIVE', 'COMPLETED', 'SUPERSEDED']);
export const WORK_ITEM_STATES = Object.freeze([
  'PLANNED', 'ASSIGNED', 'QUEUED', 'IN_PROGRESS', 'SUBMITTED', 'IN_REVIEW',
  'IN_QA', 'REWORK', 'DONE', 'BLOCKED', 'CANCELLED',
]);
export const DELIVERABLE_STATES = Object.freeze(['DRAFT', 'AWAITING_CEO', 'APPROVED', 'DELIVERED', 'CHANGES_REQUESTED']);
export const BA_RECOMMENDATIONS = Object.freeze(['ACCEPT', 'NEED_INFO', 'REJECT']);
export const CEO_DECISIONS = Object.freeze(['APPROVED', 'REJECTED', 'CHANGES_REQUESTED']);
export const PRIORITIES = Object.freeze(['P0', 'P1', 'P2', 'P3']);
export const FEATURE_PRIORITIES = Object.freeze(['MUST', 'SHOULD', 'COULD']);
export const WORKFLOW_AGENT_ROLES = Object.freeze(['BA', 'CEO_AGENT', 'PM', 'HEAD', 'SPECIALIST', 'QA', 'CLIENT']);
export const MAX_ATTEMPTS = 3;
export const TERMINAL_REQUEST_STATES = Object.freeze(['REJECTED', 'CLOSED']);
export const TERMINAL_WORK_ITEM_STATES = Object.freeze(['DONE', 'CANCELLED']);

export class WorkflowError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.status = { INVALID_TRANSITION: 409, FORBIDDEN_ACTOR: 403, SCOPE_DENIED: 404, MISSING_DATA: 422, DEPENDENCIES_PENDING: 409, BUDGET_EXCEEDED: 409, WORKER_OFFLINE: 409, STALE_SPEC: 409 }[code] || 400;
    this.details = details;
  }
}

// ── Actors ────────────────────────────────────────────────────────────────
// { kind:'user', id, organizationId, role }                 a signed-in human
// { kind:'agent', slug, organizationId, workflowRole, departmentSlug, clientId? }
// { kind:'system', organizationId }                         worker / sweeper / service
const isUser = (a) => a?.kind === 'user';
const isAgent = (a, role) => a?.kind === 'agent' && (!role || a.workflowRole === role);
// CEO and final-delivery decisions: a human org admin (the CEO seat) only.
export const canDecide = (a) => isUser(a) && ['ORG_ADMIN', 'PLATFORM_OWNER'].includes(a.role);
const canExecute = (a) => isUser(a) && hasPermission(a.role, PERMISSIONS.execute);
const canManage = (a) => isUser(a) && hasPermission(a.role, PERMISSIONS.manageProjects);

// Who may perform a transition. Each rule receives (actor, ctx).
const WHO = {
  system: (a) => a?.kind === 'system',
  operator: canExecute,
  manager: canManage,
  decider: canDecide,
  ba: (a) => isAgent(a, 'BA'),
  pm: (a) => isAgent(a, 'PM'),
  // A department head acts only on its own department's work.
  head: (a, ctx) => isAgent(a, 'HEAD') && !!ctx.item && a.departmentSlug === ctx.item.departmentSlug,
  // A specialist acts only on the item assigned to it.
  specialist: (a, ctx) => isAgent(a, 'SPECIALIST') && !!ctx.item && a.slug === ctx.item.assignedAgent,
  qa: (a) => isAgent(a, 'QA'),
  // The (simulated) client acts only on its own client's request.
  client: (a, ctx) => isAgent(a, 'CLIENT') && !!ctx.request && String(a.clientId) === String(ctx.request.clientId),
};

// ── Required data ─────────────────────────────────────────────────────────
const need = (cond, msg) => (cond ? null : msg);
const specOk = (s) => !!s && !!s.summary && s.features?.length > 0 && s.acceptanceCriteria?.length > 0 && BA_RECOMMENDATIONS.includes(s.baRecommendation);
const openQuestions = (s) => (s?.clarifyingQuestions || []).filter((q) => !q.answer?.trim());

const REQUEST_RULES = {
  'NEW>IN_ANALYSIS': { who: ['operator', 'system', 'client'] },
  'IN_ANALYSIS>NEEDS_CLIENT_INFO': {
    who: ['ba'],
    requires: ({ spec }) => [need(spec?.baRecommendation === 'NEED_INFO', 'BA recommendation must be NEED_INFO'), need(openQuestions(spec).length > 0, 'at least one unanswered clarifying question')],
  },
  'IN_ANALYSIS>ANALYSED': {
    who: ['ba'],
    requires: ({ spec }) => [need(specOk(spec), 'a complete RequirementSpec (summary, features, acceptance criteria, recommendation)'), need(spec?.baRecommendation !== 'NEED_INFO', 'NEED_INFO goes to NEEDS_CLIENT_INFO, not ANALYSED'), need(openQuestions(spec).length === 0, 'all clarifying questions answered')],
  },
  // Analysis could not run (agent failure, invalid output twice): back to NEW.
  'IN_ANALYSIS>NEW': { who: ['system'] },
  'NEEDS_CLIENT_INFO>IN_ANALYSIS': {
    who: ['operator', 'client'],
    requires: ({ spec }) => [need(!!spec, 'the RequirementSpec with the answers'), need(openQuestions(spec).length === 0, 'every clarifying question needs an answer')],
  },
  'ANALYSED>AWAITING_CEO': { who: ['system', 'operator'], requires: ({ spec }) => [need(specOk(spec), 'a complete RequirementSpec')] },
  'AWAITING_CEO>APPROVED': {
    who: ['decider'],
    requires: ({ decision, spec }) => [
      need(decision?.decision === 'APPROVED', 'an APPROVED CeoDecision'),
      need(decision?.approvedBudgetUSD > 0, 'an approved budget in USD'),
      need(PRIORITIES.includes(decision?.priority), 'a priority (P0–P3)'),
      need(!!decision?.deadline, 'a deadline'),
      need(!!spec && decision?.specHash === specHash(spec), 'the decision must be bound to the current spec version'),
    ],
  },
  'AWAITING_CEO>REJECTED': { who: ['decider'], requires: ({ decision }) => [need(decision?.decision === 'REJECTED', 'a REJECTED CeoDecision')] },
  'AWAITING_CEO>IN_ANALYSIS': {
    who: ['decider'],
    requires: ({ decision }) => [need(decision?.decision === 'CHANGES_REQUESTED', 'a CHANGES_REQUESTED CeoDecision'), need(!!decision?.notes?.trim(), 'notes telling the BA what to change')],
  },
  'APPROVED>IN_DELIVERY': { who: ['system', 'operator'], requires: ({ plan }) => [need(plan?.status === 'ACTIVE', 'an ACTIVE ProjectPlan')] },
  'IN_DELIVERY>DELIVERED': {
    who: ['decider'],
    requires: ({ deliverable }) => [need(deliverable?.ceoFinalApproval?.approved === true, 'CEO final approval of the deliverable'), need(deliverable?.items?.length > 0, 'at least one delivered item')],
  },
  'DELIVERED>CLOSED': { who: ['decider', 'client', 'operator'] },
  // Client asked for changes after delivery: a change request goes back to the BA.
  'DELIVERED>IN_ANALYSIS': { who: ['client', 'operator'], requires: ({ feedback }) => [need(feedback?.verdict === 'CHANGES_REQUESTED' && feedback.comments?.length > 0, 'client feedback with specific change requests')] },
  'REJECTED>CLOSED': { who: ['decider', 'operator'] },
};
// Withdraw: a human may close any open request.
for (const from of ['NEW', 'IN_ANALYSIS', 'NEEDS_CLIENT_INFO', 'ANALYSED', 'AWAITING_CEO', 'APPROVED', 'IN_DELIVERY']) {
  REQUEST_RULES[`${from}>CLOSED`] ||= { who: ['decider'], requires: ({ note }) => [need(!!note?.trim(), 'a reason for closing')] };
}

const evidenceOk = (e) => e && typeof e.content === 'string' && e.content.trim().length >= 3;
const WORK_RULES = {
  'PLANNED>ASSIGNED': {
    who: ['head', 'manager'],
    requires: ({ item, agent }) => [need(!!agent?.slug, 'a specialist to assign'), need(!agent || agent.departmentSlug === item.departmentSlug, 'the specialist must belong to the item\'s department'), need(!agent || agent.kind !== 'DEPARTMENT_HEAD', 'assign a specialist, not a head')],
  },
  // Reassign (human override) keeps the item in ASSIGNED.
  'ASSIGNED>ASSIGNED': { who: ['manager'], requires: ({ item, agent }) => [need(!!agent?.slug && agent.departmentSlug === item.departmentSlug, 'a specialist from the item\'s department')] },
  'ASSIGNED>QUEUED': { who: ['system', 'operator'], requires: dispatchRequirements },
  'QUEUED>IN_PROGRESS': { who: ['system'] },
  // The run ended without usable output: put it back for another attempt.
  'IN_PROGRESS>QUEUED': { who: ['system'] },
  'IN_PROGRESS>SUBMITTED': {
    who: ['specialist', 'system'],
    requires: ({ submission }) => [need(submission?.outputs?.length > 0, 'at least one output'), need(submission?.evidence?.some(evidenceOk), 'evidence (test output, diff, lint…)')],
  },
  'SUBMITTED>IN_REVIEW': { who: ['system'] },
  'IN_REVIEW>IN_QA': { who: ['head'], requires: ({ review }) => [need(review?.verdict === 'PASS', 'a PASS review'), need(review?.comments?.length > 0, 'review comments')] },
  'IN_REVIEW>REWORK': { who: ['head'], requires: ({ review }) => [need(review?.verdict === 'FAIL', 'a FAIL review'), need(review?.comments?.some((c) => c?.trim()), 'concrete comments for the specialist')] },
  'IN_QA>DONE': { who: ['qa'], requires: ({ qa, item }) => qaRequirements(qa, item, 'PASS') },
  'IN_QA>REWORK': { who: ['qa'], requires: ({ qa, item }) => qaRequirements(qa, item, 'FAIL') },
  // Rework goes back to the SAME specialist; dispatch rules apply again.
  'REWORK>QUEUED': { who: ['system', 'operator'], requires: (ctx) => [...dispatchRequirements(ctx), need(ctx.item.attempts < MAX_ATTEMPTS, `attempt limit (${MAX_ATTEMPTS}) reached`)] },
  'REWORK>BLOCKED': { who: ['system'] },
  // Human unblocks (after budget approval or fixing the cause).
  'BLOCKED>ASSIGNED': { who: ['manager'], requires: unblockRequirements },
  'BLOCKED>PLANNED': { who: ['manager'], requires: unblockRequirements },
};
// Any active item can be blocked by the system (invalid output twice, budget,
// attempt limit) and cancelled by a human operator.
for (const s of ['PLANNED', 'ASSIGNED', 'QUEUED', 'IN_PROGRESS', 'SUBMITTED', 'IN_REVIEW', 'IN_QA', 'REWORK']) {
  WORK_RULES[`${s}>BLOCKED`] ||= { who: ['system'], requires: ({ reason }) => [need(!!reason, 'a blocked reason')] };
}
for (const s of ['PLANNED', 'ASSIGNED', 'QUEUED', 'IN_PROGRESS', 'SUBMITTED', 'IN_REVIEW', 'IN_QA', 'REWORK', 'BLOCKED']) {
  WORK_RULES[`${s}>CANCELLED`] ||= { who: ['operator'] };
}

const PLAN_RULES = {
  'DRAFT>ACTIVE': {
    who: ['decider', 'manager'],
    requires: ({ plan, request, decision }) => [
      need(request?.status === 'APPROVED', 'the request must be APPROVED by the CEO'),
      ...validatePlan(plan, { approvedBudgetUSD: decision?.approvedBudgetUSD }),
    ],
  },
  'DRAFT>SUPERSEDED': { who: ['system', 'pm', 'manager'] },
  'ACTIVE>COMPLETED': { who: ['system'], requires: ({ items }) => [need(items?.length > 0 && items.every((i) => TERMINAL_WORK_ITEM_STATES.includes(i.status)) && items.some((i) => i.status === 'DONE'), 'every work item DONE or CANCELLED')] },
};

const DELIVERABLE_RULES = {
  'DRAFT>AWAITING_CEO': { who: ['pm', 'system', 'operator'], requires: ({ deliverable }) => [need(deliverable?.items?.length > 0, 'at least one DONE work item'), need(!!deliverable?.summaryReport?.trim(), 'a summary report')] },
  'AWAITING_CEO>APPROVED': { who: ['decider'] },
  'AWAITING_CEO>DRAFT': { who: ['decider'], requires: ({ note }) => [need(!!note?.trim(), 'what to change')] },
  'APPROVED>DELIVERED': { who: ['decider', 'system'] },
  'DELIVERED>CHANGES_REQUESTED': { who: ['client', 'operator'], requires: ({ feedback }) => [need(feedback?.verdict === 'CHANGES_REQUESTED' && feedback.comments?.length > 0, 'client feedback with specific change requests')] },
};

export const RULES = Object.freeze({ request: REQUEST_RULES, plan: PLAN_RULES, workItem: WORK_RULES, deliverable: DELIVERABLE_RULES });
const STATES = { request: REQUEST_STATES, plan: PLAN_STATES, workItem: WORK_ITEM_STATES, deliverable: DELIVERABLE_STATES };

export function allowedTransitions(entity, from) {
  return Object.keys(RULES[entity] || {}).filter((k) => k.startsWith(`${from}>`)).map((k) => k.split('>')[1]);
}

// The single gate. `record` is the entity being moved (must carry
// organizationId, and clientId where the entity is client-owned). Throws a
// WorkflowError; returns { from, to } when everything holds.
export function checkTransition(entity, { record, to, actor, ctx = {} }) {
  if (!STATES[entity]) throw new WorkflowError('INVALID_TRANSITION', `unknown workflow entity ${entity}`);
  if (!STATES[entity].includes(to)) throw new WorkflowError('INVALID_TRANSITION', `unknown ${entity} state ${to}`);
  const from = record?.status;
  const rule = RULES[entity][`${from}>${to}`];
  if (!rule) throw new WorkflowError('INVALID_TRANSITION', `${entity} cannot move ${from} → ${to}`, { allowed: allowedTransitions(entity, from) });
  // Scope: the actor must belong to the record's organization; a client-bound
  // actor additionally to the record's client.
  if (!actor || String(actor.organizationId) !== String(record.organizationId)) throw new WorkflowError('SCOPE_DENIED', `${entity} not found`);
  if (actor.clientId && record.clientId && String(actor.clientId) !== String(record.clientId)) throw new WorkflowError('SCOPE_DENIED', `${entity} not found`);
  const full = { ...ctx, [entity === 'workItem' ? 'item' : entity]: record };
  if (!rule.who.some((w) => WHO[w](actor, full))) {
    throw new WorkflowError('FORBIDDEN_ACTOR', `${describeActor(actor)} may not move a ${entity} ${from} → ${to} (allowed: ${rule.who.join(', ')})`);
  }
  const missing = (rule.requires?.(full) || []).filter(Boolean);
  if (missing.length) {
    const code = missing.some((m) => m.startsWith('dependencies')) ? 'DEPENDENCIES_PENDING'
      : missing.some((m) => m.startsWith('budget')) ? 'BUDGET_EXCEEDED'
        : missing.some((m) => m.startsWith('no execution worker')) ? 'WORKER_OFFLINE'
          : missing.some((m) => m.includes('current spec version')) ? 'STALE_SPEC' : 'MISSING_DATA';
    throw new WorkflowError(code, `cannot move ${entity} ${from} → ${to}: ${missing.join('; ')}`, { missing });
  }
  return { from, to };
}

export function describeActor(a) {
  if (!a) return 'unknown actor';
  if (a.kind === 'agent') return `agent ${a.slug} (${a.workflowRole || 'no workflow role'})`;
  if (a.kind === 'user') return `user with role ${a.role}`;
  return a.kind;
}

// ── Rules shared by services ──────────────────────────────────────────────
// Spec identity for CEO binding: content fields only (not ids/timestamps).
export function specHash(spec) {
  const pick = ({ requestId, version, summary, businessGoal, targetUsers, scope, features, acceptanceCriteria, clarifyingQuestions, risks, assumptions, estimate, baRecommendation, baReason }) => ({
    requestId: String(requestId), version, summary, businessGoal, targetUsers, scope, features, acceptanceCriteria,
    clarifyingQuestions: (clarifyingQuestions || []).map(({ question, answer }) => ({ question, answer })), risks, assumptions, estimate, baRecommendation, baReason,
  });
  return payloadHash(JSON.parse(JSON.stringify(pick(spec))));
}

// A work item may start only when every dependency is DONE.
export function pendingDependencies(item, siblings = []) {
  const byTask = new Map(siblings.map((s) => [s.planTaskId, s]));
  return (item.dependsOn || []).filter((dep) => byTask.get(dep)?.status !== 'DONE');
}

function unblockRequirements({ item, budgetApproved }) {
  return [need(item.blockedReason !== 'BUDGET_EXCEEDED' || budgetApproved === true, 'budget: the CEO must raise the approved budget before work continues')];
}

function dispatchRequirements({ item, siblings, workerOnline, budget }) {
  const pending = pendingDependencies(item, siblings);
  return [
    need(!!item.assignedAgent, 'an assigned specialist'),
    need(pending.length === 0, `dependencies not DONE yet: ${pending.join(', ')}`),
    need(workerOnline === true, 'no execution worker is online'),
    need(!budget || budget.ok, `budget exceeded: ${budget?.reason || ''}`),
  ];
}

// QA must prove each criterion with real evidence; "ok" is not evidence.
const VAGUE = /^(ok|okay|pass(ed)?|done|fine|good|looks good|lgtm|yes|n\/a|-)\.?$/i;
export function qaRequirements(qa, item, verdict) {
  if (!qa) return ['QA results'];
  const ids = item?.acceptanceCriteriaIds || [];
  const results = qa.criteriaResults || [];
  const out = [need(qa.verdict === verdict, `a ${verdict} QA verdict`)];
  out.push(need(results.length > 0, 'per-criterion QA results'));
  for (const id of ids) out.push(need(results.some((r) => r.criterionId === id), `a QA result for ${id}`));
  for (const r of results) out.push(need(typeof r.evidence === 'string' && r.evidence.trim().length >= 10 && !VAGUE.test(r.evidence.trim()), `real evidence for ${r.criterionId || 'a criterion'} (not "${r.evidence ?? ''}")`));
  if (verdict === 'PASS') out.push(need(results.every((r) => r.pass === true), 'every criterion passed'));
  if (verdict === 'FAIL') out.push(need(results.some((r) => r.pass === false), 'at least one failed criterion'));
  return out;
}

// After a failed review/QA: REWORK while attempts remain, then BLOCKED (a
// human is notified). `attempts` counts failed attempts so far, before this one.
export function afterFailure(item) {
  const attempts = (item.attempts || 0) + 1;
  return { attempts, to: attempts >= MAX_ATTEMPTS ? 'BLOCKED' : 'REWORK', blockedReason: attempts >= MAX_ATTEMPTS ? 'ATTEMPT_LIMIT' : null };
}

// Budget guard: spent + the next item's estimate may not exceed the approved
// budget. Without an approved budget nothing may be dispatched.
export function budgetCheck({ approvedBudgetUSD, spentUSD = 0, nextEstimateUSD = 0 }) {
  if (!(approvedBudgetUSD > 0)) return { ok: false, reason: 'no approved budget' };
  if (spentUSD > approvedBudgetUSD) return { ok: false, reason: `spent $${spentUSD.toFixed(2)} of $${approvedBudgetUSD.toFixed(2)}` };
  if (spentUSD + nextEstimateUSD > approvedBudgetUSD) return { ok: false, reason: `next item ($${nextEstimateUSD.toFixed(2)}) would exceed $${approvedBudgetUSD.toFixed(2)} (spent $${spentUSD.toFixed(2)})` };
  return { ok: true, remainingUSD: approvedBudgetUSD - spentUSD };
}

// Plan sanity: unique task ids, known dependencies, no cycles, a department
// and role per task, and a total within the approved budget.
export function validatePlan(plan, { approvedBudgetUSD } = {}) {
  const tasks = plan?.tasks || [];
  const issues = [need(tasks.length > 0, 'a plan with at least one task')];
  const ids = new Set();
  for (const t of tasks) {
    if (ids.has(t.id)) issues.push(`duplicate plan task id ${t.id}`);
    ids.add(t.id);
    if (!t.departmentSlug) issues.push(`task ${t.id} needs a department`);
    if (!t.requiredRole) issues.push(`task ${t.id} needs a required role`);
  }
  for (const t of tasks) for (const d of t.dependsOn || []) if (!ids.has(d)) issues.push(`task ${t.id} depends on unknown task ${d}`);
  const cycle = findCycle(tasks);
  if (cycle) issues.push(`dependency cycle: ${cycle.join(' → ')}`);
  const total = tasks.reduce((s, t) => s + (Number(t.budgetUSD) || 0), 0);
  if (approvedBudgetUSD > 0 && total > approvedBudgetUSD) issues.push(`budget: plan total $${total.toFixed(2)} exceeds the approved $${approvedBudgetUSD.toFixed(2)}`);
  return issues.filter(Boolean);
}

export function findCycle(tasks) {
  const deps = new Map(tasks.map((t) => [t.id, t.dependsOn || []]));
  const state = new Map();
  const stack = [];
  const visit = (id) => {
    if (state.get(id) === 2) return null;
    if (state.get(id) === 1) return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 1); stack.push(id);
    for (const d of deps.get(id) || []) { if (!deps.has(d)) continue; const c = visit(d); if (c) return c; }
    stack.pop(); state.set(id, 2);
    return null;
  };
  for (const t of tasks) { const c = visit(t.id); if (c) return c; }
  return null;
}

// Items that may be dispatched now (ASSIGNED or REWORK with deps DONE).
export function readyItems(items) {
  return items.filter((i) => ['ASSIGNED', 'REWORK'].includes(i.status) && i.assignedAgent && pendingDependencies(i, items).length === 0 && (i.status !== 'REWORK' || (i.attempts || 0) < MAX_ATTEMPTS));
}

// Which request stage a set of records represents (for the stage stepper).
export const STAGES = Object.freeze(['REQUEST', 'BA_ANALYSIS', 'CEO_DECISION', 'PM_PLAN', 'ASSIGNMENT', 'WORK', 'REVIEW_QA', 'DELIVERY']);
export function currentStage({ request, plan, items = [] }) {
  const s = request?.status;
  if (!s || s === 'NEW') return 'REQUEST';
  if (['IN_ANALYSIS', 'NEEDS_CLIENT_INFO', 'ANALYSED'].includes(s)) return 'BA_ANALYSIS';
  if (['AWAITING_CEO', 'REJECTED'].includes(s)) return 'CEO_DECISION';
  if (s === 'APPROVED') return plan?.status === 'ACTIVE' ? 'ASSIGNMENT' : 'PM_PLAN';
  if (s === 'IN_DELIVERY') {
    if (items.some((i) => ['PLANNED'].includes(i.status))) return 'ASSIGNMENT';
    if (items.some((i) => ['ASSIGNED', 'QUEUED', 'IN_PROGRESS', 'REWORK'].includes(i.status))) return 'WORK';
    if (items.some((i) => ['SUBMITTED', 'IN_REVIEW', 'IN_QA'].includes(i.status))) return 'REVIEW_QA';
    return 'DELIVERY';
  }
  return 'DELIVERY';
}
