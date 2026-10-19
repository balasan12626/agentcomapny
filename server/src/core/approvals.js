import { payloadHash } from './canonical.js';

// Approvals are bound to the exact action payload + target, expire, are
// single-use, and can never be granted by the requester (human or agent).

export const DEFAULT_APPROVAL_TTL_MS = 30 * 60 * 1000;

export class ApprovalError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function createApprovalRequest({ action, target, payload, requestedBy, ttlMs = DEFAULT_APPROVAL_TTL_MS, now = Date.now() }) {
  if (!action || !target || !requestedBy) throw new ApprovalError('INVALID', 'action, target and requestedBy are required');
  return {
    action,
    target,
    payloadHash: payloadHash({ action, target, payload }),
    requestedBy,
    status: 'PENDING',
    expiresAt: new Date(now + ttlMs),
    decidedBy: null,
    decidedAt: null,
    consumedAt: null,
  };
}

// `decider` is { id, kind: 'user'|'agent', canApprove: boolean }.
export function decideApproval(approval, decider, decision, now = Date.now()) {
  if (approval.status !== 'PENDING') throw new ApprovalError('NOT_PENDING', `Approval is ${approval.status}`);
  if (new Date(approval.expiresAt).getTime() <= now) {
    approval.status = 'EXPIRED';
    throw new ApprovalError('EXPIRED', 'Approval expired');
  }
  if (decider.kind === 'agent') throw new ApprovalError('AGENT_CANNOT_APPROVE', 'Agents cannot approve restricted actions');
  if (decider.id === approval.requestedBy) throw new ApprovalError('SELF_APPROVAL', 'Requester cannot approve their own action');
  if (!decider.canApprove) throw new ApprovalError('FORBIDDEN', 'Decider lacks approval permission');
  if (!['APPROVED', 'REJECTED'].includes(decision)) throw new ApprovalError('INVALID', 'decision must be APPROVED or REJECTED');
  approval.status = decision;
  approval.decidedBy = decider.id;
  approval.decidedAt = new Date(now);
  return approval;
}

// Called immediately before executing the restricted action. Rejects if the
// payload changed since approval, if expired, or if already consumed.
export function consumeApproval(approval, { action, target, payload }, now = Date.now()) {
  if (approval.status !== 'APPROVED') throw new ApprovalError('NOT_APPROVED', `Approval is ${approval.status}`);
  if (approval.consumedAt) throw new ApprovalError('ALREADY_USED', 'Approval already consumed');
  if (new Date(approval.expiresAt).getTime() <= now) {
    approval.status = 'EXPIRED';
    throw new ApprovalError('EXPIRED', 'Approval expired');
  }
  if (payloadHash({ action, target, payload }) !== approval.payloadHash) {
    approval.status = 'INVALIDATED';
    throw new ApprovalError('PAYLOAD_MISMATCH', 'Action payload changed after approval');
  }
  approval.consumedAt = new Date(now);
  approval.status = 'CONSUMED';
  return approval;
}
