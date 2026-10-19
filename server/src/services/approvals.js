import { Approval, Task } from '../models/index.js';
import { createApprovalRequest, decideApproval, consumeApproval } from '../core/approvals.js';
import { hasPermission, PERMISSIONS } from '../core/permissions.js';
import { appendEvent } from './events.js';
import { audit } from './audit.js';
import { transitionTask } from './tasks.js';

export async function requestApproval({ organizationId, taskId, action, target, payload, requestedBy, ttlMs }) {
  const doc = await Approval.create({ organizationId, taskId, ...createApprovalRequest({ action, target, payload, requestedBy, ttlMs }) });
  if (taskId) {
    await Task.updateOne({ _id: taskId, organizationId }, { $addToSet: { pendingApprovalIds: doc._id } });
    await appendEvent({ organizationId, taskId, kind: 'approval_requested', data: { approvalId: String(doc._id), action, target } });
  }
  return doc;
}

// membership comes from the authenticated request — never from the body.
export async function decide({ organizationId, approvalId, user, membership, decision, requestId }) {
  const doc = await Approval.findOne({ _id: approvalId, organizationId });
  if (!doc) throw Object.assign(new Error('approval not found'), { status: 404 });
  const plain = doc.toObject();
  try {
    decideApproval(plain, { id: String(user._id), kind: 'user', canApprove: hasPermission(membership.role, PERMISSIONS.approve) }, decision);
  } finally {
    // persist EXPIRED even when the decision throws
    doc.set({ status: plain.status, decidedBy: plain.decidedBy, decidedAt: plain.decidedAt });
    await doc.save();
  }
  if (doc.taskId) {
    await Task.updateOne({ _id: doc.taskId, organizationId }, { $pull: { pendingApprovalIds: doc._id } });
    await appendEvent({ organizationId, taskId: doc.taskId, kind: 'approval_decided', data: { approvalId: String(doc._id), decision } });
  }
  await audit({ organizationId, actor: { kind: 'user', id: String(user._id) }, action: `approval.${decision.toLowerCase()}`, target: String(doc._id), requestId });
  if (doc.action === 'task.accept' && doc.taskId) await applyAcceptance({ organizationId, doc, decision, user });
  return doc;
}

// Re-validate immediately before the restricted action runs.
export async function consume({ organizationId, approvalId, action, target, payload }) {
  const doc = await Approval.findOne({ _id: approvalId, organizationId });
  if (!doc) throw new Error('approval not found');
  const plain = doc.toObject();
  try {
    consumeApproval(plain, { action, target, payload });
  } finally {
    doc.set({ status: plain.status, consumedAt: plain.consumedAt });
    await doc.save();
  }
  return doc;
}

// Human acceptance review closes the remaining criteria with explicit evidence.
async function applyAcceptance({ organizationId, doc, decision, user }) {
  if (decision === 'REJECTED') return transitionTask({ organizationId, taskId: doc.taskId, to: 'FAILED', error: 'rejected in acceptance review' });
  const task = await Task.findOne({ _id: doc.taskId, organizationId });
  for (const c of task.acceptanceCriteria) {
    if (c.status === 'PENDING') { c.status = 'PASSED'; c.evidence = `human acceptance review by ${user._id}`; }
  }
  await task.save();
  return transitionTask({ organizationId, taskId: doc.taskId, to: 'COMPLETED' });
}
