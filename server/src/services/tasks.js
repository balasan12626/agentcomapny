import { Task, UsageRecord, AgentRun, Approval } from '../models/index.js';
import { assertTransition, TERMINAL_STATES } from '../core/taskStateMachine.js';
import { addUsage, budgetViolation } from '../core/usage.js';
import { appendEvent } from './events.js';

const DEFAULT_CRITERIA = {
  QUICK: [{ id: 'AC-1', description: 'Agent run finished without error', verification: 'AGENT_RUN' }],
  STANDARD: [{ id: 'AC-1', description: 'Agent run finished without error', verification: 'AGENT_RUN' }, { id: 'AC-2', description: 'Validation checks passed', verification: 'AUTOMATED' }],
};

// Idempotent: the same (organizationId, idempotencyKey) returns the existing
// task instead of creating a duplicate, even under concurrent submission.
export async function createTask({ organizationId, projectId, createdBy, idempotencyKey, instruction, mode = 'STANDARD', agents = [], acceptanceCriteria, budget, plan, management, projectSkills, kind, conversationId, resumeSessionId, workflow, workItemId }) {
  const existing = await Task.findOne({ organizationId, idempotencyKey });
  if (existing) return { task: existing, created: false };
  const criteria = acceptanceCriteria?.length ? acceptanceCriteria : DEFAULT_CRITERIA[mode] || DEFAULT_CRITERIA.STANDARD;
  try {
    // A caller-supplied plan (e.g. the CEO router's dependency-ordered stages)
    // is persisted up front so the orchestrator runs it as-is instead of
    // re-deriving one from agent watches/produces.
    const task = await Task.create({ organizationId, projectId, createdBy, idempotencyKey, instruction, mode, agents, acceptanceCriteria: criteria, budget, usage: {}, ...(plan?.stages?.length ? { plan } : {}), ...(management ? { management } : {}), ...(projectSkills?.length ? { projectSkills } : {}), ...(kind ? { kind } : {}), ...(conversationId ? { conversationId } : {}), ...(resumeSessionId ? { resumeSessionId } : {}), ...(workflow ? { workflow } : {}), ...(workItemId ? { workItemId } : {}) });
    await appendEvent({ organizationId, taskId: task._id, kind: 'state', data: { status: 'QUEUED' } });
    return { task, created: true };
  } catch (err) {
    if (err?.code === 11000) return { task: await Task.findOne({ organizationId, idempotencyKey }), created: false };
    throw err;
  }
}

// Optimistic concurrency: the update only applies if status is unchanged.
// `set` carries extra fields written atomically with the new status.
export async function transitionTask({ organizationId, taskId, to, error, set = {} }) {
  const task = await Task.findOne({ _id: taskId, organizationId });
  if (!task) throw Object.assign(new Error('task not found'), { status: 404 });
  assertTransition(task, to);
  const res = await Task.updateOne({ _id: taskId, organizationId, status: task.status }, { $set: { status: to, ...(error ? { error } : {}), ...set } });
  if (res.modifiedCount !== 1) throw Object.assign(new Error('concurrent transition'), { code: 'CONFLICT', status: 409 });
  await appendEvent({ organizationId, taskId, kind: 'state', data: { from: task.status, status: to, error } });
  return Task.findById(taskId);
}

const OPEN_RUN = ['QUEUED', 'RUNNING', 'AWAITING_APPROVAL'];

// Close the runs a task no longer owns so Runs/Sessions and Tasks agree.
export async function closeOpenRuns({ organizationId, taskId, status, error }) {
  const res = await AgentRun.updateMany({ organizationId, taskId, status: { $in: OPEN_RUN } }, { $set: { status, error, finishedAt: new Date() } });
  return res.modifiedCount || 0;
}

// Cancel is the single source of truth for every record the task owns: the
// task, its open runs and its pending approvals all change together. The
// worker notices the CANCELLED status and aborts the Claude Code process.
export async function cancelTask({ organizationId, taskId }) {
  const task = await transitionTask({ organizationId, taskId, to: 'CANCELLED', set: { cancelledAt: new Date() } });
  const runsCancelled = await closeOpenRuns({ organizationId, taskId, status: 'CANCELLED', error: 'task cancelled' });
  const approvals = await Approval.updateMany({ organizationId, taskId, status: 'PENDING' }, { $set: { status: 'INVALIDATED' } });
  if (task.pendingApprovalIds?.length) await Task.updateOne({ _id: taskId, organizationId }, { $set: { pendingApprovalIds: [] } });
  return { task: await Task.findById(taskId), runsCancelled, approvalsInvalidated: approvals.modifiedCount || 0 };
}

// Re-queue a task no worker finished. Criteria are reset because a fresh run
// produces fresh evidence; the persisted plan is kept.
export async function retryTask({ organizationId, taskId }) {
  const current = await Task.findOne({ _id: taskId, organizationId });
  if (!current) throw Object.assign(new Error('task not found'), { status: 404 });
  if (!['STALLED', 'NEEDS_INPUT'].includes(current.status)) {
    throw Object.assign(new Error(`only STALLED or NEEDS_INPUT tasks can be retried (task is ${current.status})`), { code: 'INVALID_TRANSITION', status: 409 });
  }
  await closeOpenRuns({ organizationId, taskId, status: 'FAILED', error: 'superseded by retry' });
  const criteria = (current.acceptanceCriteria || []).map((c) => ({ ...c.toObject(), status: 'PENDING', evidence: undefined }));
  return transitionTask({ organizationId, taskId, to: 'QUEUED', set: { acceptanceCriteria: criteria, attempts: (current.attempts || 0) + 1, stall: null, error: null } });
}

export const isTerminal = (status) => TERMINAL_STATES.includes(status);

export async function setCriterion({ organizationId, taskId, criterionId, status, evidence }) {
  const res = await Task.updateOne(
    { _id: taskId, organizationId, 'acceptanceCriteria.id': criterionId },
    { $set: { 'acceptanceCriteria.$.status': status, 'acceptanceCriteria.$.evidence': evidence } },
  );
  if (res.matchedCount !== 1) throw new Error(`criterion ${criterionId} not found`);
  await appendEvent({ organizationId, taskId, kind: 'acceptance', data: { criterionId, status, evidence } });
}

// Record real runtime usage for a task and enforce its budget.
export async function recordUsage({ organizationId, taskId, agentRunId, usage }) {
  await UsageRecord.create({ organizationId, taskId, agentRunId, usage });
  const task = await Task.findOne({ _id: taskId, organizationId });
  const total = addUsage(task.usage?.toObject?.() || task.usage, usage);
  await Task.updateOne({ _id: taskId, organizationId }, { $set: { usage: total } });
  await appendEvent({ organizationId, taskId, agentRunId, kind: 'usage', data: total });
  return { total, violation: budgetViolation(total, task.budget || {}) };
}
