// High-impact operations always need a human approval that the requesting
// identity cannot grant — regardless of role title (Founder/CEO/CISO included).

export const RESTRICTED_OPERATIONS = Object.freeze([
  'file.delete', 'deploy.production', 'publish.external', 'message.customer', 'finance.payment',
  'contract.sign', 'account.ownership', 'policy.change', 'security.active_test', 'disclosure.submit', 'git.push',
]);

export function requiresApproval(operation) {
  return RESTRICTED_OPERATIONS.includes(operation);
}

// An agent role never confers authority to execute a restricted op without
// an approval decided by a different, human, approval-permitted identity.
export function canExecuteRestricted({ operation, approval }) {
  if (!requiresApproval(operation)) return { allowed: true };
  if (!approval || approval.status !== 'APPROVED') return { allowed: false, reason: `${operation} requires human approval` };
  if (approval.action !== operation) return { allowed: false, reason: 'approval is for a different operation' };
  return { allowed: true };
}
