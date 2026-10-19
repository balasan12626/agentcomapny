import { Task, UsageRecord } from '../models/index.js';
import { assertTransition } from '../core/taskStateMachine.js';
import { addUsage, budgetViolation } from '../core/usage.js';
import { appendEvent } from './events.js';

const DEFAULT_CRITERIA = {
  QUICK: [{ id: 'AC-1', description: 'Agent run finished without error' }],
  STANDARD: [{ id: 'AC-1', description: 'Agent run finished without error' }, { id: 'AC-2', description: 'Validation checks passed' }],
};

// Idempotent: the same (organizationId, idempotencyKey) returns the existing
// task instead of creating a duplicate, even under concurrent submission.
export async function createTask({ organizationId, projectId, createdBy, idempotencyKey, instruction, mode = 'STANDARD', agents = [], acceptanceCriteria, budget }) {
  const existing = await Task.findOne({ organizationId, idempotencyKey });
  if (existing) return { task: existing, created: false };
  const criteria = acceptanceCriteria?.length ? acceptanceCriteria : DEFAULT_CRITERIA[mode] || DEFAULT_CRITERIA.STANDARD;
  try {
    const task = await Task.create({ organizationId, projectId, createdBy, idempotencyKey, instruction, mode, agents, acceptanceCriteria: criteria, budget, usage: {} });
    await appendEvent({ organizationId, taskId: task._id, kind: 'state', data: { status: 'QUEUED' } });
    return { task, created: true };
  } catch (err) {
    if (err?.code === 11000) return { task: await Task.findOne({ organizationId, idempotencyKey }), created: false };
    throw err;
  }
}

// Optimistic concurrency: the update only applies if status is unchanged.
export async function transitionTask({ organizationId, taskId, to, error }) {
  const task = await Task.findOne({ _id: taskId, organizationId });
  if (!task) throw Object.assign(new Error('task not found'), { status: 404 });
  assertTransition(task, to);
  const res = await Task.updateOne({ _id: taskId, organizationId, status: task.status }, { $set: { status: to, ...(error ? { error } : {}) } });
  if (res.modifiedCount !== 1) throw Object.assign(new Error('concurrent transition'), { code: 'CONFLICT', status: 409 });
  await appendEvent({ organizationId, taskId, kind: 'state', data: { from: task.status, status: to, error } });
  return Task.findById(taskId);
}

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
