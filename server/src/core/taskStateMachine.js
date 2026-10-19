// Explicit, validated task lifecycle. A task reaches COMPLETED only when its
// acceptance criteria and required verifications have passed — never merely
// because a process exited.

export const TASK_STATES = Object.freeze([
  'QUEUED', 'PLANNING', 'RUNNING', 'VALIDATING', 'AWAITING_APPROVAL', 'COMPLETED',
  'PAUSED', 'NEEDS_INPUT', 'RETRYING', 'FAILED', 'CANCELLED',
]);

export const TERMINAL_STATES = Object.freeze(['COMPLETED', 'FAILED', 'CANCELLED']);

const TRANSITIONS = {
  QUEUED: ['PLANNING', 'CANCELLED', 'FAILED'],
  PLANNING: ['RUNNING', 'NEEDS_INPUT', 'PAUSED', 'FAILED', 'CANCELLED'],
  RUNNING: ['VALIDATING', 'NEEDS_INPUT', 'PAUSED', 'RETRYING', 'FAILED', 'CANCELLED'],
  VALIDATING: ['AWAITING_APPROVAL', 'COMPLETED', 'RETRYING', 'FAILED', 'CANCELLED'],
  AWAITING_APPROVAL: ['RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'],
  PAUSED: ['QUEUED', 'CANCELLED'],
  NEEDS_INPUT: ['QUEUED', 'CANCELLED'],
  RETRYING: ['QUEUED', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export class InvalidTransitionError extends Error {
  constructor(from, to, reason) {
    super(reason || `Invalid task transition ${from} -> ${to}`);
    this.code = 'INVALID_TRANSITION';
    this.from = from;
    this.to = to;
  }
}

export function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

// Every acceptance criterion must be explicitly passed, and no approval may be
// pending. An empty criteria list is rejected: completion needs evidence.
export function completionBlockers(task) {
  const blockers = [];
  const criteria = task.acceptanceCriteria || [];
  if (criteria.length === 0) blockers.push('no acceptance criteria defined');
  for (const c of criteria) {
    if (c.status !== 'PASSED') blockers.push(`criterion not passed: ${c.id || c.description}`);
  }
  if ((task.pendingApprovalIds || []).length > 0) blockers.push('approvals pending');
  return blockers;
}

export function assertTransition(task, to) {
  const from = task.status;
  if (!TASK_STATES.includes(to)) throw new InvalidTransitionError(from, to, `Unknown state ${to}`);
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
  if (to === 'COMPLETED') {
    const blockers = completionBlockers(task);
    if (blockers.length) {
      throw new InvalidTransitionError(from, to, `Cannot complete: ${blockers.join('; ')}`);
    }
  }
  return true;
}
