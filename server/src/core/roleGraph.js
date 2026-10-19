// MetaGPT-inspired planning: each role declares the artifact types it
// `watches` (inputs) and `produces` (outputs). Stages are derived from that
// publish/subscribe graph — not from hardcoded department logic.

export class PlanError extends Error {
  constructor(message) {
    super(message);
    this.code = 'PLAN_INVALID';
  }
}

// roles: [{ slug, watches: [], produces: [] }]; seedArtifacts: types already available.
export function buildPlan(roles, { seedArtifacts = ['UserRequirement'], maxDepth = 6, maxParallel = 3 } = {}) {
  const available = new Set(seedArtifacts);
  const remaining = new Map(roles.map((r) => [r.slug, r]));
  const stages = [];
  while (remaining.size) {
    const ready = [...remaining.values()].filter((r) => (r.watches || []).every((w) => available.has(w)));
    if (!ready.length) throw new PlanError(`unsatisfiable inputs for: ${[...remaining.keys()].join(', ')}`);
    for (let i = 0; i < ready.length; i += maxParallel) stages.push(ready.slice(i, i + maxParallel).map((r) => r.slug));
    for (const r of ready) {
      remaining.delete(r.slug);
      (r.produces || []).forEach((p) => available.add(p));
    }
    if (stages.length > maxDepth) throw new PlanError(`plan exceeds max depth ${maxDepth}`);
  }
  const edges = [];
  for (const r of roles) {
    for (const w of r.watches || []) {
      for (const p of roles.filter((x) => (x.produces || []).includes(w))) edges.push({ from: p.slug, to: r.slug, artifact: w });
    }
  }
  return { stages, edges };
}
