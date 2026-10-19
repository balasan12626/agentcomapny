// Runs the delivery workflow's agent steps (docs/PHASES.md Phase 3).
// Each step is an ordinary queued Task (kind:'workflow') so it inherits the
// worker, budgets, path guard, events and redaction. The worker calls
// beforeWorkflowTask/afterWorkflowTask around execution; the agent's reply is
// parsed + schema-validated and only then applied through services/workflow.js.
// Invalid output → one retry with the validation errors → then BLOCKED (work
// items) or an escalation to a human (request-level steps).
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { Agent, AgentVersion, AgentRun, Approval, ClientRequest, Department, Membership, Project, ProjectPlan, Deliverable, Task, WorkItem } from '../models/index.js';
import { STEPS, PROMPTS, workflowRolesOf, DEFAULT_SPECIALIST_CAP_USD } from '../core/workflowSteps.js';
import { parseAgentOutput } from '../core/agentOutputs.js';
import { WorkflowError, validatePlan, TERMINAL_WORK_ITEM_STATES } from '../core/workflow.js';
import { createApprovalRequest } from '../core/approvals.js';
import { createPathGuard } from '../core/pathGuard.js';
import { createTask } from './tasks.js';
import { workerSummary } from './workspaces.js';
import { audit } from './audit.js';
import * as W from './workflow.js';

const ITEM_STEPS = new Set(['head.assign', 'specialist.work', 'head.review', 'qa.verify']);
const ESCALATION_TTL_MS = 7 * 24 * 3600 * 1000;
class OutputError extends Error { constructor(issues) { super(issues.join('; ')); this.issues = issues; } }

// ── Context ───────────────────────────────────────────────────────────────
async function loadContext(organizationId, step, refId) {
  if (!mongoose.isValidObjectId(refId)) throw new WorkflowError('SCOPE_DENIED', 'workflow record not found');
  const item = ITEM_STEPS.has(step) ? await WorkItem.findOne({ _id: refId, organizationId }).lean() : null;
  const requestId = item ? item.requestId : refId;
  const request = await ClientRequest.findOne({ _id: requestId, organizationId }).lean();
  if (!request || (ITEM_STEPS.has(step) && !item)) throw new WorkflowError('SCOPE_DENIED', 'workflow record not found');
  const [spec, decision] = await Promise.all([W.currentSpec(organizationId, request._id), W.currentDecision(organizationId, request._id)]);
  return { organizationId: String(organizationId), step, request, spec, decision, item };
}

async function departmentsWithRoles(organizationId) {
  const scope = { $or: [{ organizationId }, { organizationId: null }] };
  const [depts, agents] = await Promise.all([Department.find(scope).sort({ order: 1 }).lean(), Agent.find({ ...scope, enabled: { $ne: false }, kind: { $in: ['CORE_ROLE', 'DEPARTMENT_HEAD'] } }).lean()]);
  return depts.map((d) => ({
    slug: d.slug, head: d.head?.slug,
    roles: agents.filter((a) => a.departmentSlug === d.slug && workflowRolesOf(a).has('SPECIALIST')).map((a) => a.slug),
    roleAgents: agents.filter((a) => a.departmentSlug === d.slug && workflowRolesOf(a).has('SPECIALIST')),
  }));
}

const versionTag = (step, ctx) => ({
  'ba.analyse': `h${ctx.request.history.length}`,
  'ceo.brief': `v${ctx.spec?.version}`,
  'pm.plan': `d${ctx.decision?._id}`,
  // Item steps key on the item's history length: every state change (rework,
  // unblock) yields a fresh key, so a step can never be silently deduplicated.
  'head.assign': `h${ctx.item?.history.length}`,
  'specialist.work': `h${ctx.item?.history.length}`,
  'head.review': `h${ctx.item?.history.length}`,
  'qa.verify': `h${ctx.item?.history.length}`,
  'pm.deliverable': `p${ctx.request.currentPlanId}`,
}[step]);

// Tasks need a human owner; system-scheduled steps run under the request's
// creator, else an organization admin.
async function ownerFor(organizationId, request) {
  if (request.createdBy) return request.createdBy;
  const admin = await Membership.findOne({ organizationId, role: { $in: ['ORG_ADMIN', 'PLATFORM_OWNER'] } }).sort({ createdAt: 1 }).lean();
  if (!admin) throw new WorkflowError('MISSING_DATA', 'no organization admin to own system-scheduled work');
  return admin.userId;
}

// Queue one agent step. Refuses while no worker is online, never queues for a
// project without a workspace, and is idempotent per (step, record, version, attempt).
export async function scheduleStep({ organizationId, step, refId, attempt = 0, feedback = [], enqueue }) {
  const def = STEPS[step];
  if (!def) throw new WorkflowError('INVALID_TRANSITION', `unknown workflow step ${step}`);
  const ctx = await loadContext(organizationId, step, refId);
  if ((await workerSummary()).status !== 'ONLINE') throw new WorkflowError('WORKER_OFFLINE', 'no execution worker is online — start it with npm run dev');
  const projectId = ctx.item?.projectId || ctx.request.projectId;
  const project = projectId && await Project.findOne({ _id: projectId, organizationId }).lean();
  if (!project?.workspace?.allowedRoots?.length) throw new WorkflowError('MISSING_DATA', 'the request needs a project with a workspace before agents can work on it');
  const slug = def.agent(ctx);
  const agent = slug && await Agent.findOne({ slug, enabled: { $ne: false }, $or: [{ organizationId }, { organizationId: null }] }).lean();
  if (!agent || !(await AgentVersion.exists({ agentId: agent._id, status: 'PUBLISHED' }))) throw new WorkflowError('MISSING_DATA', `agent ${slug || '(none)'} for ${step} is not available — seed the catalogue`);
  if (!workflowRolesOf(agent).has(def.role)) throw new WorkflowError('FORBIDDEN_ACTOR', `agent ${slug} cannot act as ${def.role}`);
  const extra = step === 'pm.plan' ? { departments: await departmentsWithRoles(organizationId) }
    : step === 'ba.analyse' ? { departments: (await Department.find({ $or: [{ organizationId }, { organizationId: null }] }).lean()).map((d) => d.slug) }
      : step === 'head.assign' ? { candidates: (await departmentsWithRoles(organizationId)).find((d) => d.slug === ctx.item.departmentSlug)?.roleAgents || [] }
        : step === 'pm.deliverable' ? { items: await WorkItem.find({ organizationId, requestId: ctx.request._id, status: 'DONE' }).lean() } : {};
  const prompt = PROMPTS[step]({ ...ctx, ...extra, feedback });
  const cap = def.maxCostUsd ?? (ctx.item?.budgetUSD || DEFAULT_SPECIALIST_CAP_USD);
  const { task, created } = await createTask({
    organizationId, projectId: project._id, createdBy: await ownerFor(organizationId, ctx.request),
    idempotencyKey: `wf:${step}:${refId}:${versionTag(step, ctx)}:r${attempt}`,
    instruction: prompt, mode: def.mode, kind: 'workflow', agents: [{ slug }],
    acceptanceCriteria: [{ id: 'ac-1', description: `${slug} returns a ${step} result (validated against its schema)`, verification: 'AGENT_RUN', role: slug }],
    budget: { maxCostUsd: cap }, plan: { stages: [[slug]], edges: [] },
    workflow: { step, refId: String(refId), requestId: ctx.request._id, agentSlug: slug, attempt },
    ...(ctx.item ? { workItemId: ctx.item._id } : {}),
  });
  if (created) {
    await enqueue({ organizationId, taskId: task._id });
    await audit({ organizationId, actor: { kind: 'system', id: 'workflow' }, action: 'workflow.step.scheduled', target: String(task._id), details: { step, refId: String(refId), agent: slug, attempt } });
  }
  return { task, created };
}

// ── Worker hooks ──────────────────────────────────────────────────────────
export async function beforeWorkflowTask({ organizationId, taskId }) {
  const task = await Task.findOne({ _id: taskId, organizationId }).lean();
  if (task?.workflow?.step !== 'specialist.work') return;
  const item = await WorkItem.findOne({ _id: task.workflow.refId, organizationId }).lean();
  if (item?.status === 'QUEUED') await W.startWork({ organizationId, workItemId: item._id, taskId: task._id });
}

const finish = (task, outcome, issues = []) => Task.updateOne({ _id: task._id, 'workflow.outcome': null }, { $set: { 'workflow.outcome': outcome, 'workflow.issues': issues.slice(0, 20), 'workflow.processedAt': new Date() } });

export async function afterWorkflowTask({ organizationId, taskId, enqueue }) {
  const task = await Task.findOne({ _id: taskId, organizationId }).lean();
  if (task?.kind !== 'workflow' || !task.workflow?.step || task.workflow.outcome) return { skipped: true };
  const { step, refId, attempt = 0 } = task.workflow;
  if (task.status === 'CANCELLED') { await finish(task, 'CANCELLED'); return { outcome: 'CANCELLED' }; }
  const run = await AgentRun.findOne({ organizationId, taskId }).sort({ createdAt: -1 }).lean();
  let issues;
  if (task.status !== 'COMPLETED') {
    issues = [`the agent run did not complete (${task.status}${task.error ? `: ${task.error}` : ''})`];
  } else {
    const parsed = parseAgentOutput(step, run?.summary);
    if (!parsed.ok) issues = parsed.errors;
    else {
      try {
        await apply(step, { organizationId: String(organizationId), refId, task, data: parsed.data });
        await finish(task, 'APPLIED');
        await audit({ organizationId, actor: { kind: 'agent', id: task.workflow.agentSlug }, action: 'workflow.step.applied', target: String(task._id), details: { step, refId } });
        const advanced = await advance({ organizationId, requestId: task.workflow.requestId, enqueue }).catch((err) => ({ error: err.message }));
        return { outcome: 'APPLIED', advanced };
      } catch (err) {
        if (!(err instanceof OutputError) && !(err instanceof WorkflowError)) throw err;
        // The record moved on while the agent ran (e.g. cancelled): nothing to apply.
        if (err instanceof WorkflowError && err.code === 'INVALID_TRANSITION') { await finish(task, 'SKIPPED', [err.message]); return { outcome: 'SKIPPED', reason: err.message }; }
        issues = err.issues || [err.message];
      }
    }
  }
  await finish(task, 'INVALID', issues);
  await audit({ organizationId, actor: { kind: 'agent', id: task.workflow.agentSlug }, action: 'workflow.step.invalid', target: String(task._id), details: { step, refId, attempt, issues: issues.slice(0, 5) } });
  if (attempt < 1) {
    try {
      await scheduleStep({ organizationId, step, refId, attempt: attempt + 1, feedback: issues, enqueue });
      return { outcome: 'INVALID', retried: true, issues };
    } catch (err) {
      issues = [...issues, `retry could not be scheduled: ${err.message}`];
    }
  }
  await giveUp({ organizationId, step, refId, issues });
  return { outcome: 'INVALID', retried: false, issues };
}

// Second invalid output: work items are BLOCKED (human notified by block());
// request-level steps escalate to a human, and analysis returns to NEW.
async function giveUp({ organizationId, step, refId, issues }) {
  const note = `${step} output invalid twice: ${issues.slice(0, 3).join('; ')}`.slice(0, 1900);
  if (ITEM_STEPS.has(step)) {
    const item = await WorkItem.findOne({ _id: refId, organizationId }).lean();
    if (item && !TERMINAL_WORK_ITEM_STATES.includes(item.status) && item.status !== 'BLOCKED') await W.block({ organizationId, workItemId: item._id, reason: 'INVALID_OUTPUT', note });
    return;
  }
  if (step === 'ba.analyse') {
    const req = await ClientRequest.findOne({ _id: refId, organizationId }).lean();
    if (req?.status === 'IN_ANALYSIS') await W.move('request', { organizationId, id: refId, to: 'NEW', actor: W.systemActor(organizationId), note });
  }
  await Approval.create({ organizationId, ...createApprovalRequest({ action: 'workflow.escalation', target: `request:${refId}`, payload: { step, refId: String(refId), issues }, requestedBy: 'system:workflow', ttlMs: ESCALATION_TTL_MS }) });
}

// ── Applying validated output ─────────────────────────────────────────────
const agentAs = (organizationId, slug, workflowRole, departmentSlug) => W.agentActor({ organizationId, slug, workflowRole, departmentSlug });

async function apply(step, { organizationId, refId, task, data }) {
  const slug = task.workflow.agentSlug;
  const cost = task.usage?.costUsd || 0;
  const tokens = (task.usage?.inputTokens || 0) + (task.usage?.outputTokens || 0);
  if (step === 'ba.analyse') return applySpec({ organizationId, requestId: refId, actor: agentAs(organizationId, slug, 'BA'), data, task });
  if (step === 'ceo.brief') {
    const spec = await W.currentSpec(organizationId, refId);
    const res = await ClientRequest.updateOne({ _id: refId, organizationId, status: 'AWAITING_CEO' }, { $set: { ceoBrief: { ...data, specVersion: spec?.version, taskId: task._id, at: new Date() } } });
    if (res.modifiedCount !== 1) throw new WorkflowError('INVALID_TRANSITION', 'the request is no longer waiting for the CEO');
    return null;
  }
  if (step === 'pm.plan') return applyPlan({ organizationId, requestId: refId, actor: agentAs(organizationId, slug, 'PM'), data, task });
  if (step === 'pm.deliverable') return W.compileDeliverable({ organizationId, requestId: refId, actor: agentAs(organizationId, slug, 'PM'), summaryReport: data.summaryReport });

  const item = await WorkItem.findOne({ _id: refId, organizationId }).lean();
  const charge = () => WorkItem.updateOne({ _id: item._id, organizationId }, { $inc: { costUSD: cost, tokens }, $addToSet: { taskIds: task._id } });
  if (step === 'head.assign') {
    const out = await W.assignWorkItem({ organizationId, workItemId: item._id, actor: agentAs(organizationId, slug, 'HEAD', item.departmentSlug), agentSlug: data.agentSlug });
    await charge();
    return out;
  }
  if (step === 'specialist.work') {
    const outputs = await checkOutputs(organizationId, item, data.outputs);
    const runIds = (await AgentRun.find({ organizationId, taskId: task._id }).select('_id').lean()).map((r) => r._id);
    await WorkItem.updateOne({ _id: item._id, organizationId }, { $addToSet: { taskIds: task._id } });
    return W.submitWork({ organizationId, workItemId: item._id, actor: agentAs(organizationId, slug, 'SPECIALIST', item.departmentSlug), outputs, evidence: data.evidence, costUSD: cost, tokens, agentRunIds: runIds });
  }
  if (step === 'head.review') {
    await charge();
    return W.reviewWorkItem({ organizationId, workItemId: item._id, actor: agentAs(organizationId, slug, 'HEAD', item.departmentSlug), verdict: data.verdict, comments: data.comments });
  }
  if (step === 'qa.verify') {
    await charge();
    return W.qaWorkItem({ organizationId, workItemId: item._id, actor: agentAs(organizationId, slug, 'QA'), verdict: data.verdict, criteriaResults: data.criteriaResults });
  }
  throw new WorkflowError('INVALID_TRANSITION', `no applier for ${step}`);
}

// Answered questions from earlier rounds stay; new questions get ids that do
// not collide with them.
async function applySpec({ organizationId, requestId, actor, data, task }) {
  const prev = await W.currentSpec(organizationId, requestId);
  const answered = (prev?.clarifyingQuestions || []).filter((q) => q.answer?.trim());
  let n = answered.reduce((m, q) => Math.max(m, Number(String(q.id).split('-')[1]) || 0), 0);
  const fresh = data.clarifyingQuestions.map((q) => (answered.some((a) => a.id === q.id) ? { ...q, id: `Q-${++n}` } : q));
  const runIds = (await AgentRun.find({ organizationId, taskId: task._id }).select('_id').lean()).map((r) => r._id);
  await W.saveSpec({ organizationId, requestId, actor, spec: { ...data, clarifyingQuestions: [...answered, ...fresh] }, agentRunIds: runIds });
  return W.concludeAnalysis({ organizationId, requestId, actor });
}

// Beyond the schema: departments and roles must exist, criteria ids must be
// the spec's, every criterion covered, DAG + budget valid (core validatePlan).
async function applyPlan({ organizationId, requestId, actor, data, task }) {
  const [spec, decision, depts] = await Promise.all([W.currentSpec(organizationId, requestId), W.currentDecision(organizationId, requestId), departmentsWithRoles(organizationId)]);
  const issues = [];
  const acIds = new Set((spec?.acceptanceCriteria || []).map((c) => c.id));
  for (const t of data.tasks) {
    const dept = depts.find((d) => d.slug === t.departmentSlug);
    if (!dept) issues.push(`task ${t.id}: unknown department ${t.departmentSlug}`);
    else if (!dept.roles.includes(t.requiredRole)) issues.push(`task ${t.id}: ${t.requiredRole} is not a specialist role in ${t.departmentSlug}`);
    for (const id of t.acceptanceCriteriaIds) if (!acIds.has(id)) issues.push(`task ${t.id}: unknown acceptance criterion ${id}`);
  }
  for (const id of acIds) if (!data.tasks.some((t) => t.acceptanceCriteriaIds.includes(id))) issues.push(`acceptance criterion ${id} is not covered by any task`);
  issues.push(...validatePlan(data, { approvedBudgetUSD: decision?.approvedBudgetUSD }));
  if (issues.length) throw new OutputError(issues);
  const runIds = (await AgentRun.find({ organizationId, taskId: task._id }).select('_id').lean()).map((r) => r._id);
  return W.savePlan({ organizationId, requestId, actor, milestones: data.milestones.map((m) => ({ ...m, dueDate: m.dueDate ? new Date(m.dueDate) : undefined })), tasks: data.tasks, agentRunIds: runIds });
}

// Every "file" output must exist inside the project workspace (path guard:
// no traversal, no symlink escape). Paths are stored as <workspace>/relative.
async function checkOutputs(organizationId, item, outputs) {
  const project = await Project.findOne({ _id: item.projectId, organizationId }).lean();
  const root = project.workspace.allowedRoots[0];
  const guard = createPathGuard({ allowedRoots: project.workspace.allowedRoots, deniedPatterns: project.workspace.deniedPatterns?.length ? project.workspace.deniedPatterns : undefined });
  const issues = [];
  const out = outputs.map((o) => {
    if (o.type !== 'file') return o;
    const rel = o.path.replace(/^<workspace>[\\/]?/, '');
    try {
      const abs = guard(path.resolve(root, rel));
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) issues.push(`output file ${rel} does not exist in the workspace`);
    } catch (err) {
      issues.push(`output file ${rel} is not allowed: ${err.message}`);
    }
    return { ...o, path: `<workspace>/${rel.replace(/\\/g, '/')}` };
  });
  if (issues.length) throw new OutputError(issues);
  return out;
}

// ── The driver: schedule whatever the records say should happen next ──────
async function open(organizationId, step, refId) {
  return Task.exists({ organizationId, kind: 'workflow', 'workflow.step': step, 'workflow.refId': String(refId), 'workflow.outcome': null });
}

export async function advance({ organizationId, requestId, enqueue }) {
  const request = await ClientRequest.findOne({ _id: requestId, organizationId }).lean();
  if (!request) throw new WorkflowError('SCOPE_DENIED', 'request not found');
  if ((await workerSummary()).status !== 'ONLINE') return { scheduled: [], held: 'WORKER_OFFLINE' };
  const scheduled = [];
  const problems = [];
  const go = async (step, refId) => {
    if (await open(organizationId, step, refId)) return;
    try { const r = await scheduleStep({ organizationId, step, refId, enqueue }); if (r.created) scheduled.push({ step, refId: String(refId), taskId: String(r.task._id) }); } catch (err) { if (!(err instanceof WorkflowError)) throw err; problems.push({ step, refId: String(refId), code: err.code, reason: err.message }); }
  };
  const spec = await W.currentSpec(organizationId, request._id);
  if (request.status === 'IN_ANALYSIS') await go('ba.analyse', request._id);
  else if (request.status === 'AWAITING_CEO' && request.ceoBrief?.specVersion !== spec?.version) await go('ceo.brief', request._id);
  else if (request.status === 'APPROVED') {
    const decision = await W.currentDecision(organizationId, request._id);
    const plan = await ProjectPlan.findOne({ organizationId, requestId: request._id, decisionId: decision?._id, status: { $in: ['DRAFT', 'ACTIVE'] } }).lean();
    if (!plan) await go('pm.plan', request._id);
  } else if (request.status === 'IN_DELIVERY') {
    const items = await WorkItem.find({ organizationId, requestId: request._id }).lean();
    for (const i of items.filter((x) => x.status === 'PLANNED' && x.assignedHead)) await go('head.assign', i._id);
    await W.dispatchReady({
      organizationId, requestId: request._id,
      onQueued: async (item) => {
        try { const r = await scheduleStep({ organizationId, step: 'specialist.work', refId: item._id, enqueue }); if (r.created) scheduled.push({ step: 'specialist.work', refId: String(item._id), taskId: String(r.task._id) }); } catch (err) {
          if (!(err instanceof WorkflowError)) throw err;
          await W.block({ organizationId, workItemId: item._id, reason: 'EXECUTION_ERROR', note: err.message });
          problems.push({ step: 'specialist.work', refId: String(item._id), code: err.code, reason: err.message });
        }
      },
    });
    for (const i of items.filter((x) => x.status === 'IN_REVIEW')) await go('head.review', i._id);
    for (const i of items.filter((x) => x.status === 'IN_QA')) await go('qa.verify', i._id);
    const plan = await ProjectPlan.findById(request.currentPlanId).lean();
    const fresh = await WorkItem.find({ organizationId, requestId: request._id }).select('status').lean();
    const settled = fresh.length && fresh.every((x) => TERMINAL_WORK_ITEM_STATES.includes(x.status)) && fresh.some((x) => x.status === 'DONE');
    const delivered = await Deliverable.exists({ organizationId, requestId: request._id, status: { $in: ['AWAITING_CEO', 'APPROVED', 'DELIVERED'] } });
    if (settled && plan?.status === 'COMPLETED' && !delivered) await go('pm.deliverable', request._id);
  }
  return { scheduled, problems };
}
