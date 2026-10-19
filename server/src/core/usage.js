// Token/cost accounting from real Claude Code runtime output. Never estimate
// or fabricate usage: only `result`/`assistant` events reported by the CLI count.

export function emptyUsage() {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0, turns: 0 };
}

export function usageFromClaudeEvent(event) {
  if (!event || event.type !== 'result' || !event.usage) return null;
  const u = event.usage;
  return {
    inputTokens: u.input_tokens || 0,
    outputTokens: u.output_tokens || 0,
    cacheReadTokens: u.cache_read_input_tokens || 0,
    cacheCreationTokens: u.cache_creation_input_tokens || 0,
    costUsd: typeof event.total_cost_usd === 'number' ? event.total_cost_usd : 0,
    turns: event.num_turns || 0,
  };
}

export function addUsage(a, b) {
  const out = emptyUsage();
  for (const k of Object.keys(out)) out[k] = (a?.[k] || 0) + (b?.[k] || 0);
  out.costUsd = Math.round(out.costUsd * 1e6) / 1e6;
  return out;
}

export function totalTokens(u) {
  return (u.inputTokens || 0) + (u.outputTokens || 0) + (u.cacheReadTokens || 0) + (u.cacheCreationTokens || 0);
}

// budget: { maxTokens?, maxCostUsd? }. Returns null when within budget.
export function budgetViolation(usage, budget = {}) {
  if (budget.maxTokens && totalTokens(usage) > budget.maxTokens) return `token budget exceeded (${totalTokens(usage)} > ${budget.maxTokens})`;
  if (budget.maxCostUsd && usage.costUsd > budget.maxCostUsd) return `cost budget exceeded (${usage.costUsd} > ${budget.maxCostUsd})`;
  return null;
}
