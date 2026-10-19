// Authorized bug-bounty scope gate. No scope record → passive review only.

const REQUIRED = ['programOwner', 'authorizedAssets', 'permittedTests', 'excludedTests', 'dataHandling', 'stopConditions', 'escalationContact'];

export function validateScope(scope) {
  if (!scope) return { valid: false, errors: ['explicit scope record required'] };
  const errors = REQUIRED.filter((k) => !scope[k] || (Array.isArray(scope[k]) && scope[k].length === 0)).map((k) => `missing ${k}`);
  if (scope.windowEnd && new Date(scope.windowEnd) < new Date()) errors.push('testing window has ended');
  return { valid: errors.length === 0, errors };
}

function hostMatches(host, pattern) {
  if (pattern.startsWith('*.')) return host.endsWith(pattern.slice(1)) && host !== pattern.slice(2);
  return host === pattern;
}

// Returns the most permissive mode allowed for a request.
export function assessmentMode(scope, { host, testType }) {
  const v = validateScope(scope);
  if (!v.valid) return { mode: 'PASSIVE_ONLY', reasons: v.errors };
  const h = String(host || '').toLowerCase();
  if ((scope.excludedAssets || []).some((p) => hostMatches(h, p))) return { mode: 'DENIED', reasons: ['asset explicitly excluded'] };
  if (!scope.authorizedAssets.some((p) => hostMatches(h, p))) return { mode: 'DENIED', reasons: ['asset not in authorized scope'] };
  if (scope.excludedTests.includes(testType)) return { mode: 'DENIED', reasons: [`test type excluded: ${testType}`] };
  if (!scope.permittedTests.includes(testType)) return { mode: 'PASSIVE_ONLY', reasons: [`test type not explicitly permitted: ${testType}`] };
  return { mode: 'ACTIVE_ALLOWED', reasons: [] };
}

export const FINDING_STATES = ['DISCOVERED', 'TRIAGED', 'VALIDATING', 'CONFIRMED', 'REJECTED', 'REMEDIATION_PLANNED', 'FIXED', 'RETESTED', 'CLOSED'];
const FINDING_NEXT = {
  DISCOVERED: ['TRIAGED', 'REJECTED'],
  TRIAGED: ['VALIDATING', 'REJECTED'],
  VALIDATING: ['CONFIRMED', 'REJECTED'],
  CONFIRMED: ['REMEDIATION_PLANNED'],
  REMEDIATION_PLANNED: ['FIXED'],
  FIXED: ['RETESTED'],
  RETESTED: ['CLOSED', 'REMEDIATION_PLANNED'],
  REJECTED: ['CLOSED'],
  CLOSED: [],
};
export function canAdvanceFinding(from, to) {
  return (FINDING_NEXT[from] || []).includes(to);
}
