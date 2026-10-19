// CFO budget allocation: split a task budget across the team the CEO selected.
// Pure and deterministic. Build roles get a larger share than advisory roles,
// and a reserve is held back for retries/validation. Each agent's share becomes
// a hard per-run cap (Claude Code `--max-budget-usd`), so a multi-agent task
// can no longer spend N x its budget.

// Relative weight by department: hands-on build/test work costs more turns
// than advisory, read-only analysis.
export const DEPARTMENT_WEIGHTS = Object.freeze({
  'software-engineering': 3,
  'qa-devops-cloud': 2,
  'data-ai': 2,
  'cybersecurity': 2,
  'product-delivery': 1.5,
});
const DEFAULT_WEIGHT = 1;
export const RESERVE_RATIO = 0.1;
export const MIN_SHARE_USD = 0.05;

const toCents = (usd) => Math.round(usd * 100);

export function allocateBudget(coreRoles, totalUsd, { reserveRatio = RESERVE_RATIO } = {}) {
  const total = Number(totalUsd);
  if (!Array.isArray(coreRoles) || coreRoles.length === 0) throw new Error('no roles to fund');
  if (!Number.isFinite(total) || total <= 0) throw new Error('budget must be a positive amount');

  const totalCents = toCents(total);
  const reserveCents = Math.round(totalCents * reserveRatio);
  const spendable = totalCents - reserveCents;
  const minCents = toCents(MIN_SHARE_USD);
  if (spendable < minCents * coreRoles.length) {
    throw new Error(`budget too small: need at least $${((minCents * coreRoles.length + reserveCents) / 100).toFixed(2)} for ${coreRoles.length} role(s)`);
  }

  const weights = coreRoles.map((r) => DEPARTMENT_WEIGHTS[r.departmentSlug] ?? DEFAULT_WEIGHT);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const cents = weights.map((w) => Math.floor((spendable * w) / weightSum));
  // Hand leftover cents (from flooring) to the heaviest roles so shares sum exactly.
  let leftover = spendable - cents.reduce((a, b) => a + b, 0);
  const order = weights.map((w, i) => i).sort((a, b) => weights[b] - weights[a] || a - b);
  for (let k = 0; leftover > 0; k = (k + 1) % order.length, leftover -= 1) cents[order[k]] += 1;

  const allocations = coreRoles.map((r, i) => ({
    slug: r.slug,
    name: r.name,
    departmentSlug: r.departmentSlug,
    weight: weights[i],
    maxCostUsd: cents[i] / 100,
  }));
  return {
    approvedBy: 'cfo',
    totalUsd: totalCents / 100,
    reserveUsd: reserveCents / 100,
    allocatedUsd: spendable / 100,
    allocations,
  };
}
