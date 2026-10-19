// Applies core/workflow.js to the database. Every status change goes through
// `move()`: rule check → conditional update (optimistic, status must be
// unchanged) → history entry → redacted audit row. Actors are built by the
// caller: the HTTP layer only ever builds *user* actors from the session's
// membership (never from the body); agent and system actors exist only inside
// the worker/services. CEO and final-delivery decisions accept users only.
import mongoose from 'mongoose';
import {
  ClientRequest, RequirementSpec, CeoDecision, ProjectPlan, WorkItem, Deliverable, ClientFeedback,
  Client, Project, Agent, Approval, Department,
} from '../models/index.js';
import {
  checkTransition, WorkflowError, specHash, afterFailure, budgetCheck, readyItems, canDecide,
  TERMINAL_WORK_ITEM_STATES, describeActor,
} from '../core/workflow.js';
import { createApprovalRequest } from '../core/approvals.js';
import { workerSummary } from './workspaces.js';
import { audit } from './audit.js';

const MODELS = { request: ClientRequest, plan: ProjectPlan, workItem: WorkItem, deliverable: Deliverable };
const ESCALATION_TTL_MS = 7 * 24 * 3600 * 1000;

export const userActor = (user, membership) => ({ kind: 'user', id: String(user._id), organizationId: String(membership.organizationId), role: membership.role });
export const systemActor = (organizationId, id = 'workflow') => ({ kind: 'system', id, organizationId: String(organizationId) });
export const agentActor = ({ organizationId, slug, workflowRole, departmentSlug, clientId }) => ({ kind: 'agent', id: slug, slug, organizationId: String(organizationId), workflowRole, departmentSlug, ...(clientId ? { clientId: String(clientId) } : {}) });
const actorRef = (a) => ({ kind: a.kind, id: a.id || a.slug, role: a.role || a.workflowRole });

const notFound = (entity) => new WorkflowError('SCOPE_DENIED', `${entity} not found`);
async function load(entity, organizationId, id) {
  if (!mongoose.isValidObjectId(id)) throw notFound(entity);
  const doc = await MODELS[entity].findOne({ _id: id, organizationId }).lean();
  if (!doc) throw notFound(entity);
  return doc;
}

// The one place statuses change.
export async function move(entity, { organizationId, id, to, actor, ctx = {}, set = {}, note, requestId: httpRequestId }) {
  const record = await load(entity, organizationId, id);
  const { from } = checkTransition(entity, { record, to, actor, ctx: { ...ctx, note } });
  const entry = { from, status: to, by: actorRef(actor), at: new Date(), ...(note ? { note: String(note).slice(0, 2000) } : {}) };
  const res = await MODELS[entity].updateOne({ _id: record._id, organizationId, status: from }, { $set: { status: to, ...set }, $push: { history: entry } });
  if (res.modifiedCount !== 1) throw Object.assign(new WorkflowError('INVALID_TRANSITION', `${entity} changed concurrently; reload and retry`), { status: 409 });
  await audit({ organizationId, actor: actorRef(actor), action: `workflow.${entity}.${to.toLowerCase()}`, target: String(record._id), requestId: httpRequestId, details: { from, to, ...(note ? { note } : {}) } });
  return MODELS[entity].findById(record._id).lean();
}

// ── Requests + BA ─────────────────────────────────────────────────────────
export async function createRequest({ organizationId, actor, clientId, projectId, title, description, attachments = [], requestedPriority, desiredDeadline, source = 'HUMAN', isDemo = false, demoScenarioId, requestId }) {
  const client = mongoose.isValidObjectId(clientId) && await Client.findOne({ _id: clientId, organizationId }).lean();
  if (!client) throw notFound('client');
  if (actor.clientId && String(actor.clientId) !== String(client._id)) throw notFound('client');
  if (projectId) {
    const project = mongoose.isValidObjectId(projectId) && await Project.findOne({ _id: projectId, organizationId }).lean();
    if (!project) throw notFound('project');
    if (String(project.clientId) !== String(client._id)) throw new WorkflowError('MISSING_DATA', 'the project belongs to a different client');
  }
  const doc = await ClientRequest.create({
    organizationId, clientId: client._id, projectId, title, description, attachments, requestedPriority, desiredDeadline,
    submittedBy: actorRef(actor), source, isDemo: isDemo || source === 'CLIENT_AGENT', demoScenarioId,
    createdBy: actor.kind === 'user' ? actor.id : undefined,
    history: [{ from: null, status: 'NEW', by: actorRef(actor), at: new Date() }],
  });
  await audit({ organizationId, actor: actorRef(actor), action: 'workflow.request.new', target: String(doc._id), requestId, details: { clientId: String(client._id), source } });
  return doc.toObject();
}

export async function currentSpec(organizationId, requestId) {
  return RequirementSpec.findOne({ organizationId, requestId }).sort({ version: -1 }).lean();
}
export async function currentDecision(organizationId, requestId) {
  return CeoDecision.findOne({ organizationId, requestId }).sort({ decidedAt: -1, _id: -1 }).lean();
}

// Hash the normalized document (schema defaults applied) so the stored hash
// always equals specHash() of the record read back later.
async function persistSpec(fields) {
  const doc = new RequirementSpec({ ...fields, hash: 'pending' });
  doc.hash = specHash(doc.toObject());
  return doc.save();
}

// The BA writes a new spec version; its hash is what the CEO approves.
export async function saveSpec({ organizationId, requestId, actor, spec, agentRunIds = [] }) {
  if (actor.kind !== 'agent' || actor.workflowRole !== 'BA') throw new WorkflowError('FORBIDDEN_ACTOR', `${describeActor(actor)} may not write requirements`);
  const request = await load('request', organizationId, requestId);
  if (request.status !== 'IN_ANALYSIS') throw new WorkflowError('INVALID_TRANSITION', `requirements can only be written while the request is IN_ANALYSIS (it is ${request.status})`);
  const prev = await currentSpec(organizationId, request._id);
  const version = (prev?.version || 0) + 1;
  const body = { ...spec, requestId: request._id, version };
  const doc = await persistSpec({ ...body, organizationId, clientId: request.clientId, writtenBy: actorRef(actor), agentRunIds });
  await ClientRequest.updateOne({ _id: request._id, organizationId }, { $set: { currentSpecId: doc._id } });
  await audit({ organizationId, actor: actorRef(actor), action: 'workflow.spec.write', target: String(doc._id), details: { requestId: String(request._id), version, recommendation: spec.baRecommendation } });
  return doc.toObject();
}

// BA output → NEEDS_CLIENT_INFO (questions) or ANALYSED (then AWAITING_CEO).
export async function concludeAnalysis({ organizationId, requestId, actor }) {
  const spec = await currentSpec(organizationId, requestId);
  const to = spec?.baRecommendation === 'NEED_INFO' ? 'NEEDS_CLIENT_INFO' : 'ANALYSED';
  const moved = await move('request', { organizationId, id: requestId, to, actor, ctx: { spec } });
  if (to === 'ANALYSED') return move('request', { organizationId, id: requestId, to: 'AWAITING_CEO', actor: systemActor(organizationId), ctx: { spec } });
  return moved;
}

// Client (or an operator on its behalf) answers; answers become a new spec
// version so a CEO decision can never bind to stale content.
export async function answerQuestions({ organizationId, requestId, actor, answers }) {
  const request = await load('request', organizationId, requestId);
  if (request.status !== 'NEEDS_CLIENT_INFO') throw new WorkflowError('INVALID_TRANSITION', `answers are only accepted while the request NEEDS_CLIENT_INFO (it is ${request.status})`);
  const spec = await currentSpec(organizationId, request._id);
  const byId = new Map(answers.map((a) => [a.id, a.answer]));
  const questions = (spec.clarifyingQuestions || []).map((q) => (byId.has(q.id) && String(byId.get(q.id)).trim()
    ? { ...q, answer: String(byId.get(q.id)).trim(), answeredBy: actorRef(actor), answeredAt: new Date() } : q));
  const { _id, createdAt, updatedAt, hash, ...rest } = spec;
  const body = { ...rest, clarifyingQuestions: questions, version: spec.version + 1 };
  // Recommendation stays NEED_INFO until the BA re-analyses.
  const next = (await persistSpec(body)).toObject();
  await ClientRequest.updateOne({ _id: request._id, organizationId }, { $set: { currentSpecId: next._id } });
  if (questions.some((q) => !q.answer?.trim())) return { request, spec: next, complete: false };
  const moved = await move('request', { organizationId, id: request._id, to: 'IN_ANALYSIS', actor, ctx: { spec: next } });
  return { request: moved, spec: next, complete: true };
}

// ── CEO (human only) ──────────────────────────────────────────────────────
export async function decideAsCeo({ organizationId, requestId, actor, decision, approvedBudgetUSD, priority, deadline, notes, specHash: expectedHash, briefRunId, httpRequestId }) {
  if (!canDecide(actor)) throw new WorkflowError('FORBIDDEN_ACTOR', `${describeActor(actor)} cannot make CEO decisions — only a human organization admin can`);
  const request = await load('request', organizationId, requestId);
  if (request.status !== 'AWAITING_CEO') throw new WorkflowError('INVALID_TRANSITION', `the request is ${request.status}, not AWAITING_CEO`);
  const spec = await currentSpec(organizationId, request._id);
  if (!spec) throw new WorkflowError('MISSING_DATA', 'no requirement spec to decide on');
  // The human decided on what they saw: refuse if the spec changed since.
  if (expectedHash && expectedHash !== spec.hash) throw new WorkflowError('STALE_SPEC', 'the requirements changed since you opened them; reload before deciding');
  const to = { APPROVED: 'APPROVED', REJECTED: 'REJECTED', CHANGES_REQUESTED: 'IN_ANALYSIS' }[decision];
  const draft = { decision, approvedBudgetUSD, priority, deadline, notes, specHash: spec.hash };
  // Validate the transition before persisting the decision record.
  checkTransition('request', { record: request, to, actor, ctx: { spec, decision: draft } });
  const doc = (await CeoDecision.create({ organizationId, clientId: request.clientId, requestId: request._id, specId: spec._id, specVersion: spec.version, ...draft, decidedBy: actor.id, decidedByRole: actor.role, briefRunId })).toObject();
  const moved = await move('request', { organizationId, id: request._id, to, actor, ctx: { spec, decision: doc }, note: notes, requestId: httpRequestId });
  return { request: moved, decision: doc };
}

// ── PM plan ───────────────────────────────────────────────────────────────
export async function savePlan({ organizationId, requestId, actor, projectId, milestones = [], tasks, agentRunIds = [] }) {
  if (!(actor.kind === 'agent' && actor.workflowRole === 'PM') && !(actor.kind === 'user' && canDecide(actor))) throw new WorkflowError('FORBIDDEN_ACTOR', `${describeActor(actor)} may not write project plans`);
  const request = await load('request', organizationId, requestId);
  if (request.status !== 'APPROVED') throw new WorkflowError('INVALID_TRANSITION', `plans are written after CEO approval (request is ${request.status})`);
  const pid = projectId || request.projectId;
  const project = pid && mongoose.isValidObjectId(pid) && await Project.findOne({ _id: pid, organizationId, clientId: request.clientId }).lean();
  if (!project) throw new WorkflowError('MISSING_DATA', 'the plan needs a project of this client to work in');
  const decision = await currentDecision(organizationId, request._id);
  const prev = await ProjectPlan.findOne({ organizationId, requestId: request._id }).sort({ version: -1 }).lean();
  if (prev?.status === 'DRAFT') await move('plan', { organizationId, id: prev._id, to: 'SUPERSEDED', actor: systemActor(organizationId) });
  const doc = await ProjectPlan.create({
    organizationId, clientId: request.clientId, requestId: request._id, projectId: project._id, decisionId: decision?._id,
    version: (prev?.version || 0) + 1, milestones, tasks, status: 'DRAFT', writtenBy: actorRef(actor), agentRunIds,
    history: [{ from: null, status: 'DRAFT', by: actorRef(actor), at: new Date() }],
  });
  await ClientRequest.updateOne({ _id: request._id, organizationId }, { $set: { currentPlanId: doc._id, projectId: project._id } });
  await audit({ organizationId, actor: actorRef(actor), action: 'workflow.plan.draft', target: String(doc._id), details: { requestId: String(request._id), tasks: tasks.length } });
  return doc.toObject();
}

// Activating a plan creates one WorkItem per plan task and moves the request
// into delivery. Heads then assign specialists.
export async function activatePlan({ organizationId, planId, actor, httpRequestId }) {
  const plan = await load('plan', organizationId, planId);
  const request = await load('request', organizationId, plan.requestId);
  const decision = await currentDecision(organizationId, request._id);
  const active = await move('plan', { organizationId, id: plan._id, to: 'ACTIVE', actor, ctx: { plan, request, decision }, requestId: httpRequestId });
  const heads = await departmentHeads(organizationId);
  const items = await WorkItem.insertMany(plan.tasks.map((t) => ({
    organizationId, clientId: plan.clientId, projectId: plan.projectId, requestId: plan.requestId, planId: plan._id, planTaskId: t.id,
    title: t.title, description: t.description, departmentSlug: t.departmentSlug, requiredRole: t.requiredRole, dependsOn: t.dependsOn || [],
    acceptanceCriteriaIds: t.acceptanceCriteriaIds || [], estimateHours: t.estimateHours, budgetUSD: t.budgetUSD,
    assignedHead: heads.get(t.departmentSlug) || null, status: 'PLANNED',
    history: [{ from: null, status: 'PLANNED', by: actorRef(actor), at: new Date() }],
  })));
  await move('request', { organizationId, id: request._id, to: 'IN_DELIVERY', actor: systemActor(organizationId), ctx: { plan: active } });
  return { plan: active, items: items.map((i) => i.toObject()) };
}

async function departmentHeads(organizationId) {
  const depts = await Department.find({ $or: [{ organizationId }, { organizationId: null }] }).lean();
  return new Map(depts.map((d) => [d.slug, d.head?.slug]));
}

// ── Work items ────────────────────────────────────────────────────────────
export async function assignWorkItem({ organizationId, workItemId, actor, agentSlug, httpRequestId }) {
  const item = await load('workItem', organizationId, workItemId);
  const agent = await Agent.findOne({ slug: agentSlug, enabled: { $ne: false }, $or: [{ organizationId }, { organizationId: null }] }).lean();
  const to = 'ASSIGNED';
  return move('workItem', {
    organizationId, id: item._id, to, actor, ctx: { agent: agent && { slug: agent.slug, departmentSlug: agent.departmentSlug, kind: agent.kind } },
    set: { assignedAgent: agent?.slug, assignedBy: actorRef(actor), assignedAt: new Date(), blockedReason: null }, requestId: httpRequestId,
  });
}

async function spendFor(organizationId, requestId) {
  const [row] = await WorkItem.aggregate([{ $match: { organizationId: new mongoose.Types.ObjectId(String(organizationId)), requestId: new mongoose.Types.ObjectId(String(requestId)) } }, { $group: { _id: null, cost: { $sum: '$costUSD' } } }]);
  return row?.cost || 0;
}

// Queue every item whose dependencies are DONE, inside the approved budget,
// while a worker is online. Returns what was queued and what was held back.
export async function dispatchReady({ organizationId, requestId, actor = systemActor(organizationId), onQueued }) {
  const items = await WorkItem.find({ organizationId, requestId }).lean();
  const decision = await currentDecision(organizationId, requestId);
  const workerOnline = (await workerSummary()).status === 'ONLINE';
  let spent = await spendFor(organizationId, requestId);
  const queued = [];
  const held = [];
  for (const item of readyItems(items)) {
    const budget = budgetCheck({ approvedBudgetUSD: decision?.approvedBudgetUSD, spentUSD: spent, nextEstimateUSD: item.budgetUSD || 0 });
    try {
      const moved = await move('workItem', { organizationId, id: item._id, to: 'QUEUED', actor, ctx: { siblings: items, workerOnline, budget } });
      queued.push(moved);
      spent += item.budgetUSD || 0; // reserve the estimate
      await onQueued?.(moved);
    } catch (err) {
      if (!(err instanceof WorkflowError)) throw err;
      held.push({ workItemId: String(item._id), code: err.code, reason: err.message });
    }
  }
  return { queued, held, workerOnline };
}

// The worker picked the item up; `taskId` is the execution Task for this attempt.
export async function startWork({ organizationId, workItemId, taskId }) {
  const doc = await move('workItem', { organizationId, id: workItemId, to: 'IN_PROGRESS', actor: systemActor(organizationId, 'worker') });
  return taskId ? WorkItem.findOneAndUpdate({ _id: doc._id, organizationId }, { $addToSet: { taskIds: taskId } }, { new: true }).lean() : doc;
}

// Specialist submits; the item goes straight to its head's review queue.
export async function submitWork({ organizationId, workItemId, actor, outputs, evidence, costUSD = 0, tokens = 0, agentRunIds = [] }) {
  await move('workItem', {
    organizationId, id: workItemId, to: 'SUBMITTED', actor, ctx: { submission: { outputs, evidence } },
    set: { outputs, evidence },
  });
  await WorkItem.updateOne({ _id: workItemId, organizationId }, { $inc: { costUSD, tokens }, $addToSet: { agentRunIds: { $each: agentRunIds } } });
  const reviewing = await move('workItem', { organizationId, id: workItemId, to: 'IN_REVIEW', actor: systemActor(organizationId) });
  await enforceBudget({ organizationId, requestId: reviewing.requestId });
  return reviewing;
}

// Head review: PASS → QA; FAIL → REWORK (same specialist) or BLOCKED after
// the attempt limit, with a human escalation in the Approvals inbox.
export async function reviewWorkItem({ organizationId, workItemId, actor, verdict, comments = [] }) {
  const item = await load('workItem', organizationId, workItemId);
  const review = { reviewer: actor.slug || actor.id, verdict, comments, attempt: item.attempts + 1, at: new Date() };
  if (verdict === 'PASS') {
    return move('workItem', { organizationId, id: item._id, to: 'IN_QA', actor, ctx: { review }, set: {}, note: comments[0] })
      .then(() => WorkItem.findOneAndUpdate({ _id: item._id, organizationId }, { $push: { reviews: review } }, { new: true }).lean());
  }
  return fail({ item, actor, ctx: { review }, push: { reviews: review }, note: comments.join(' | ') });
}

// QA: every acceptance criterion needs a result with real evidence.
export async function qaWorkItem({ organizationId, workItemId, actor, verdict, criteriaResults = [] }) {
  const item = await load('workItem', organizationId, workItemId);
  const qa = { qaAgent: actor.slug || actor.id, verdict, criteriaResults, attempt: item.attempts + 1, at: new Date() };
  if (verdict === 'PASS') {
    await move('workItem', { organizationId, id: item._id, to: 'DONE', actor, ctx: { qa } });
    const done = await WorkItem.findOneAndUpdate({ _id: item._id, organizationId }, { $push: { qaResults: qa } }, { new: true }).lean();
    await maybeCompletePlan({ organizationId, planId: item.planId });
    return done;
  }
  return fail({ item, actor, ctx: { qa }, push: { qaResults: qa }, note: criteriaResults.filter((r) => !r.pass).map((r) => `${r.criterionId}: ${r.evidence}`).join(' | ') });
}

async function fail({ item, actor, ctx, push, note }) {
  const { organizationId } = item;
  // The reviewer's own rule (role, department, concrete comments) is checked
  // even when the attempt limit turns the result into BLOCKED.
  checkTransition('workItem', { record: item, to: 'REWORK', actor, ctx });
  const next = afterFailure(item);
  await WorkItem.updateOne({ _id: item._id, organizationId, status: item.status }, { $push: push, $set: { attempts: next.attempts } });
  const fresh = { ...item, attempts: next.attempts };
  if (next.to === 'REWORK') return move('workItem', { organizationId, id: item._id, to: 'REWORK', actor, ctx: { ...ctx, item: fresh }, note });
  return block({ organizationId, workItemId: item._id, reason: 'ATTEMPT_LIMIT', note: `failed ${next.attempts} attempts: ${note}` });
}

// BLOCKED always notifies a human through the Approvals inbox.
export async function block({ organizationId, workItemId, reason, note }) {
  const moved = await move('workItem', { organizationId, id: workItemId, to: 'BLOCKED', actor: systemActor(organizationId), ctx: { reason }, set: { blockedReason: reason }, note });
  const approval = await Approval.create({
    organizationId,
    ...createApprovalRequest({ action: 'workflow.escalation', target: `workItem:${workItemId}`, payload: { workItemId: String(workItemId), reason }, requestedBy: 'system:workflow', ttlMs: ESCALATION_TTL_MS }),
  });
  return WorkItem.findOneAndUpdate({ _id: workItemId, organizationId }, { $set: { escalationApprovalId: approval._id } }, { new: true }).lean();
}

// Budget guard: once spend passes the approved budget every not-yet-started
// item is paused (BLOCKED: BUDGET_EXCEEDED) until the CEO raises the budget.
export async function enforceBudget({ organizationId, requestId }) {
  const decision = await currentDecision(organizationId, requestId);
  const spent = await spendFor(organizationId, requestId);
  const check = budgetCheck({ approvedBudgetUSD: decision?.approvedBudgetUSD, spentUSD: spent });
  if (check.ok) return { ok: true, spentUSD: spent, paused: 0 };
  const waiting = await WorkItem.find({ organizationId, requestId, status: { $in: ['PLANNED', 'ASSIGNED', 'QUEUED', 'REWORK'] } }).select('_id').lean();
  for (const w of waiting) await block({ organizationId, workItemId: w._id, reason: 'BUDGET_EXCEEDED', note: check.reason });
  return { ok: false, spentUSD: spent, paused: waiting.length, reason: check.reason };
}

// Only a human CEO raises the budget; this records a new APPROVED decision
// bound to the same spec.
export async function raiseBudget({ organizationId, requestId, actor, approvedBudgetUSD, notes }) {
  if (!canDecide(actor)) throw new WorkflowError('FORBIDDEN_ACTOR', `${describeActor(actor)} cannot change the approved budget`);
  const prev = await currentDecision(organizationId, requestId);
  if (prev?.decision !== 'APPROVED') throw new WorkflowError('INVALID_TRANSITION', 'the request has no approved decision to amend');
  if (!(approvedBudgetUSD > prev.approvedBudgetUSD)) throw new WorkflowError('MISSING_DATA', `the new budget must be above $${prev.approvedBudgetUSD}`);
  const { _id, createdAt, updatedAt, ...rest } = prev;
  const doc = (await CeoDecision.create({ ...rest, approvedBudgetUSD, notes, decidedBy: actor.id, decidedByRole: actor.role, decidedAt: new Date() })).toObject();
  await audit({ organizationId, actor: actorRef(actor), action: 'workflow.budget.raise', target: String(requestId), details: { from: prev.approvedBudgetUSD, to: approvedBudgetUSD } });
  return doc;
}

// Human unblock: back to ASSIGNED (same specialist). A budget block needs the
// budget to be back in range first.
export async function unblockWorkItem({ organizationId, workItemId, actor, note }) {
  const item = await load('workItem', organizationId, workItemId);
  const decision = await currentDecision(organizationId, item.requestId);
  const budgetApproved = budgetCheck({ approvedBudgetUSD: decision?.approvedBudgetUSD, spentUSD: await spendFor(organizationId, item.requestId) }).ok;
  const reset = item.blockedReason === 'ATTEMPT_LIMIT' ? { attempts: 0 } : {};
  // Never-assigned items go back to their head for assignment.
  const to = item.assignedAgent ? 'ASSIGNED' : 'PLANNED';
  const moved = await move('workItem', { organizationId, id: item._id, to, actor, ctx: { budgetApproved }, set: { blockedReason: null, ...reset }, note });
  if (item.escalationApprovalId) await Approval.updateOne({ _id: item.escalationApprovalId, organizationId, status: 'PENDING' }, { $set: { status: 'CONSUMED', consumedAt: new Date(), decidedBy: actor.id, decidedAt: new Date() } });
  return moved;
}

export async function maybeCompletePlan({ organizationId, planId }) {
  const plan = await load('plan', organizationId, planId);
  if (plan.status !== 'ACTIVE') return plan;
  const items = await WorkItem.find({ organizationId, planId }).select('status').lean();
  if (!(items.length && items.every((i) => TERMINAL_WORK_ITEM_STATES.includes(i.status)) && items.some((i) => i.status === 'DONE'))) return plan;
  return move('plan', { organizationId, id: plan._id, to: 'COMPLETED', actor: systemActor(organizationId), ctx: { items } });
}

// ── Delivery ──────────────────────────────────────────────────────────────
export async function compileDeliverable({ organizationId, requestId, actor, summaryReport }) {
  const request = await load('request', organizationId, requestId);
  if (request.status !== 'IN_DELIVERY') throw new WorkflowError('INVALID_TRANSITION', `deliverables are compiled during delivery (request is ${request.status})`);
  const done = await WorkItem.find({ organizationId, requestId: request._id, status: 'DONE' }).lean();
  const prev = await Deliverable.findOne({ organizationId, requestId: request._id }).sort({ version: -1 }).lean();
  const doc = await Deliverable.create({
    organizationId, clientId: request.clientId, requestId: request._id, projectId: request.projectId, version: (prev?.version || 0) + 1,
    items: done.map((i) => ({ workItemId: i._id, title: i.title, outputs: i.outputs })), summaryReport, status: 'DRAFT',
    history: [{ from: null, status: 'DRAFT', by: actorRef(actor), at: new Date() }],
  });
  return move('deliverable', { organizationId, id: doc._id, to: 'AWAITING_CEO', actor, ctx: { deliverable: doc.toObject() } });
}

// Human CEO final approval → DELIVERED (deliverable + request).
export async function approveDeliverable({ organizationId, deliverableId, actor, notes, httpRequestId }) {
  if (!canDecide(actor)) throw new WorkflowError('FORBIDDEN_ACTOR', `${describeActor(actor)} cannot give final delivery approval — only a human organization admin can`);
  const deliverable = await load('deliverable', organizationId, deliverableId);
  const ceoFinalApproval = { approved: true, by: actor.id, role: actor.role, at: new Date(), notes };
  await move('deliverable', { organizationId, id: deliverable._id, to: 'APPROVED', actor, set: { ceoFinalApproval }, note: notes, requestId: httpRequestId });
  const delivered = await move('deliverable', { organizationId, id: deliverable._id, to: 'DELIVERED', actor, set: { deliveredAt: new Date() } });
  const request = await move('request', { organizationId, id: deliverable.requestId, to: 'DELIVERED', actor, ctx: { deliverable: delivered }, requestId: httpRequestId });
  return { deliverable: delivered, request };
}

// Client verdict on a delivery: ACCEPT closes; CHANGES_REQUESTED opens a
// change request back to the BA.
export async function recordClientFeedback({ organizationId, deliverableId, actor, verdict, comments = [] }) {
  const deliverable = await load('deliverable', organizationId, deliverableId);
  const request = await load('request', organizationId, deliverable.requestId);
  if (actor.clientId && String(actor.clientId) !== String(request.clientId)) throw notFound('deliverable');
  const feedback = { verdict, comments };
  const target = verdict === 'ACCEPT' ? 'CLOSED' : 'IN_ANALYSIS';
  checkTransition('request', { record: request, to: target, actor, ctx: { feedback } });
  const doc = (await ClientFeedback.create({ organizationId, clientId: request.clientId, requestId: request._id, deliverableId: deliverable._id, verdict, comments, by: actorRef(actor) })).toObject();
  if (verdict === 'ACCEPT') {
    await Deliverable.updateOne({ _id: deliverable._id, organizationId }, { $set: { clientAcknowledged: true } });
  } else {
    await move('deliverable', { organizationId, id: deliverable._id, to: 'CHANGES_REQUESTED', actor, ctx: { feedback, request } });
  }
  const moved = await move('request', { organizationId, id: request._id, to: target, actor, ctx: { feedback }, note: comments.join(' | ') || undefined });
  return { feedback: doc, request: moved };
}

// ── Timeline: who did what, at which stage ────────────────────────────────
export async function timeline({ organizationId, requestId }) {
  const request = await load('request', organizationId, requestId);
  const [specs, decisions, plans, items, deliverables, feedback] = await Promise.all([
    RequirementSpec.find({ organizationId, requestId: request._id }).sort({ version: 1 }).lean(),
    CeoDecision.find({ organizationId, requestId: request._id }).sort({ decidedAt: 1 }).lean(),
    ProjectPlan.find({ organizationId, requestId: request._id }).lean(),
    WorkItem.find({ organizationId, requestId: request._id }).lean(),
    Deliverable.find({ organizationId, requestId: request._id }).lean(),
    ClientFeedback.find({ organizationId, requestId: request._id }).lean(),
  ]);
  const rows = [];
  const add = (entity, ref, h) => rows.push({ entity, ref, from: h.from ?? null, status: h.status, by: h.by, at: h.at, note: h.note });
  for (const h of request.history) add('request', String(request._id), h);
  for (const s of specs) rows.push({ entity: 'spec', ref: String(s._id), status: `v${s.version} ${s.baRecommendation || ''}`.trim(), by: s.writtenBy || null, at: s.createdAt });
  for (const d of decisions) rows.push({ entity: 'ceoDecision', ref: String(d._id), status: d.decision, by: { kind: 'user', id: String(d.decidedBy), role: d.decidedByRole }, at: d.decidedAt, note: d.notes });
  for (const p of plans) for (const h of p.history) add('plan', String(p._id), h);
  for (const i of items) for (const h of i.history) add(`workItem:${i.planTaskId}`, String(i._id), h);
  for (const d of deliverables) for (const h of d.history) add('deliverable', String(d._id), h);
  for (const f of feedback) rows.push({ entity: 'clientFeedback', ref: String(f._id), status: f.verdict, by: f.by, at: f.at, note: f.comments.join(' | ') });
  return rows.sort((a, b) => new Date(a.at) - new Date(b.at));
}
