// Dynamic CEO routing: turn a free-text request into a MINIMAL sufficient team
// drawn from the company catalogue. Pure and deterministic so it can be unit
// tested without a database or any Claude execution. The CEO selects only the
// departments / core roles a request needs — never every agent for every task.
//
// Input `catalog` is the shape returned by GET /orgs/:id/catalog:
//   { executive, departments: [{ slug, name, head, coreRoles: [{ slug, name,
//     departmentSlug, type, subAgents: [{ slug, name }] }] }] }

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'for', 'with', 'to', 'of', 'in', 'on', 'new', 'our', 'my', 'please', 'build', 'create', 'make', 'add', 'set', 'up', 'need', 'want', 'help', 'me', 'it', 'this', 'that', 'into', 'from', 'by', 'at', 'is', 'are', 'can', 'you']);

// Curated keywords that map common request words to a core-role slug. Keeps
// routing robust without a model. Extend as the catalogue grows.
const ROLE_KEYWORDS = {
  'frontend-engineer': ['frontend', 'ui', 'react', 'nextjs', 'next.js', 'page', 'portal', 'dashboard', 'form', 'button', 'screen', 'client-side'],
  'backend-engineer': ['backend', 'api', 'login', 'register', 'registration', 'auth', 'authentication', 'authorization', 'endpoint', 'server', 'session', 'jwt'],
  'full-stack-engineer': ['feature', 'integration', 'end-to-end', 'full-stack', 'fullstack'],
  'database-engineer': ['database', 'db', 'mongodb', 'schema', 'index', 'query', 'migration'],
  'software-architect': ['architecture', 'design', 'system', 'scalability', 'refactor'],
  'product-manager': ['requirement', 'requirements', 'story', 'stories', 'scope', 'spec', 'product'],
  'ui-ux-designer': ['ux', 'wireframe', 'prototype', 'usability'],
  'project-manager': ['sprint', 'plan', 'planning', 'timeline', 'dependency', 'dependencies', 'milestone'],
  'technical-writer': ['documentation', 'docs', 'guide', 'manual', 'readme'],
  'qa-engineer': ['test', 'tests', 'testing', 'qa', 'quality', 'regression', 'functional'],
  'automation-test-engineer': ['automation', 'automated', 'playwright', 'e2e', 'selenium'],
  'devops-engineer': ['deploy', 'deployment', 'ci', 'cd', 'pipeline', 'release', 'docker'],
  'cloud-engineer': ['cloud', 'aws', 'azure', 'gcp', 'infrastructure', 'cost'],
  'sre-performance-engineer': ['reliability', 'performance', 'load', 'uptime', 'monitoring', 'latency', 'sre'],
  'security-architect': ['threat', 'threat-model', 'security'],
  'application-security-engineer': ['secure', 'vulnerability', 'xss', 'sqli', 'owasp', 'pentest'],
  'vulnerability-management-engineer': ['dependency', 'cve', 'scanning', 'triage'],
  'authorized-bug-bounty-researcher': ['bug', 'bounty', 'scope'],
  'security-operations-engineer': ['incident', 'logs', 'soc', 'breach'],
  'data-analyst': ['kpi', 'metrics', 'analysis', 'analytics', 'data'],
  'bi-engineer': ['bi', 'powerbi', 'tableau'],
  'data-engineer': ['etl', 'warehouse', 'ingest', 'pipeline'],
  'machine-learning-engineer': ['ml', 'model', 'training', 'machine', 'learning'],
  'ai-rag-engineer': ['rag', 'retrieval', 'embedding', 'knowledge', 'llm'],
  'seo-specialist': ['seo', 'ranking', 'keyword', 'keywords', 'on-page', 'backlink', 'serp'],
  'geo-specialist': ['geo', 'answer', 'engine', 'ai-search', 'generative'],
  'paid-advertising-specialist': ['ads', 'ppc', 'adwords', 'campaign', 'advertising'],
  'content-and-copywriting-specialist': ['content', 'copy', 'copywriting', 'blog', 'landing'],
  'marketing-analytics-specialist': ['ga4', 'gtm', 'conversion', 'attribution'],
  'sales-development-specialist': ['lead', 'leads', 'prospect', 'outbound'],
  'sales-research-specialist': ['research', 'company', 'decision-maker'],
  'proposal-and-rfp-specialist': ['proposal', 'rfp', 'quote', 'bid'],
  'crm-operations-specialist': ['crm', 'salesforce', 'hubspot'],
  'account-and-revenue-manager': ['account', 'forecast', 'revenue', 'quota'],
  'customer-support-specialist': ['ticket', 'support', 'complaint'],
  'technical-support-engineer': ['troubleshoot', 'escalation', 'bug-report'],
  'knowledge-management-specialist': ['knowledge', 'kb', 'faq'],
  'customer-success-manager': ['onboarding', 'churn', 'retention', 'health'],
  'customer-experience-analyst': ['feedback', 'satisfaction', 'nps', 'csat'],
  'finance-analyst': ['budget', 'finance', 'financial', 'variance'],
  'accounts-operations-specialist': ['invoice', 'reconciliation', 'payable', 'receivable'],
  'procurement-specialist': ['vendor', 'procurement', 'purchase', 'supplier'],
  'risk-and-compliance-specialist': ['compliance', 'policy', 'gdpr', 'hipaa', 'soc2'],
  'legal-operations-assistant': ['contract', 'clause', 'legal', 'nda', 'obligation'],
  'business-operations-analyst': ['process', 'sop', 'operations', 'workflow'],
  'hr-operations-specialist': ['hr', 'recruitment', 'hiring', 'employee', 'onboard'],
  'executive-intelligence-analyst': ['competitor', 'market', 'intelligence'],
  'automation-engineer': ['integration', 'webhook', 'zapier', 'automate'],
  'executive-reporting-specialist': ['briefing', 'executive', 'ceo-report', 'summary'],
};

const tokenize = (s) => String(s).toLowerCase().match(/[a-z0-9][a-z0-9.+#-]*/g)?.filter((t) => t.length > 1 && !STOP.has(t)) || [];

export function planFromRequest(request, catalog) {
  const tokens = new Set(tokenize(request));
  const roleIndex = new Map(); // slug -> { role, deptSlug, deptName, head }
  for (const d of catalog.departments || []) {
    for (const r of d.coreRoles || []) roleIndex.set(r.slug, { role: r, deptSlug: d.slug, deptName: d.name, head: d.head });
  }

  // Score each core role: curated domain keywords are strong signals (+2),
  // role-name tokens are weaker (+1), so a request's dominant capability wins
  // over incidental name overlaps (e.g. "customer" in a portal request).
  const scored = [];
  for (const [slug, info] of roleIndex) {
    const curated = new Set(ROLE_KEYWORDS[slug] || []);
    const nameKw = new Set(tokenize(info.role.name));
    let score = 0;
    for (const t of tokens) {
      if (curated.has(t)) score += 2;
      else if (nameKw.has(t)) score += 1;
    }
    if (score > 0) scored.push({ slug, score, ...info });
  }
  scored.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));

  const isQuestion = /\?\s*$/.test(String(request).trim()) || /^(what|who|why|how|when|where|is|are|does|can|should)\b/i.test(String(request).trim());

  // No capability matched → CEO answers directly or asks the user.
  if (scored.length === 0) {
    return {
      intent: isQuestion ? 'question' : 'clarify',
      summary: isQuestion
        ? 'No specialist capability required; CEO answers directly.'
        : 'Could not map the request to a capability — CEO should ask the user to clarify scope.',
      departments: [], coreRoles: [], subAgents: [],
      dependencies: [], acceptanceCriteria: [],
      coordinator: catalog.executive?.slug || 'founder-ceo',
    };
  }

  // Minimal sufficient team: keep only clearly-relevant roles. When any strong
  // (curated) match exists, drop weak name-only (score 1) matches; always cap.
  const maxScore = scored[0].score;
  const threshold = maxScore >= 2 ? 2 : 1;
  const chosen = scored.filter((c) => c.score >= threshold).slice(0, 6);
  const deptSlugs = [...new Set(chosen.map((c) => c.deptSlug))];
  const coreRoles = chosen.map((c) => ({ slug: c.slug, name: c.role.name, departmentSlug: c.deptSlug, headSlug: c.head?.slug, score: c.score }));
  const subAgents = chosen.flatMap((c) => (c.role.subAgents || []).map((s) => ({ slug: s.slug, name: s.name, coreRoleSlug: c.slug })));

  const intent = coreRoles.length === 1 ? 'task' : 'workflow';
  // Simple dependency heuristic: design/architecture & product precede build; build precedes test/deploy.
  const order = ['product-manager', 'software-architect', 'ui-ux-designer', 'database-engineer', 'backend-engineer', 'frontend-engineer', 'full-stack-engineer', 'qa-engineer', 'automation-test-engineer', 'devops-engineer'];
  const rank = (slug) => { const i = order.indexOf(slug); return i === -1 ? order.length : i; };
  const dependencies = [];
  const sortedForDeps = [...coreRoles].sort((a, b) => rank(a.slug) - rank(b.slug));
  for (let i = 1; i < sortedForDeps.length; i += 1) {
    if (rank(sortedForDeps[i].slug) > rank(sortedForDeps[i - 1].slug)) {
      dependencies.push({ from: sortedForDeps[i - 1].slug, to: sortedForDeps[i].slug });
    }
  }

  return {
    intent,
    summary: `CEO plan: ${coreRoles.length} role(s) across ${deptSlugs.length} department(s) — ${coreRoles.map((r) => r.name).join(', ')}.`,
    coordinator: catalog.executive?.slug || 'founder-ceo',
    departmentHeads: deptSlugs.map((ds) => roleIndexHead(catalog, ds)).filter(Boolean),
    departments: deptSlugs,
    coreRoles,
    subAgents,
    dependencies,
    acceptanceCriteria: [
      'Each selected role delivers its output with supporting evidence',
      'Dependencies respected; independent work may run in parallel',
      'Restricted actions require independent human approval before execution',
    ],
  };
}

function roleIndexHead(catalog, deptSlug) {
  const d = (catalog.departments || []).find((x) => x.slug === deptSlug);
  return d?.head?.slug ? { slug: d.head.slug, title: d.head.title, departmentSlug: deptSlug } : null;
}

// Convert a CEO plan into the persisted Task shape (agents, dependency-layered
// stages, edges, acceptance criteria) the existing orchestrator understands.
// Pure: no DB, no execution. Stages = Kahn topological layers so independent
// roles run in parallel and dependents wait.
export function planToTask(plan) {
  const roles = plan.coreRoles.map((r) => r.slug);
  const edges = (plan.dependencies || []).filter((e) => roles.includes(e.from) && roles.includes(e.to));
  const indeg = new Map(roles.map((s) => [s, 0]));
  const adj = new Map(roles.map((s) => [s, []]));
  for (const e of edges) { indeg.set(e.to, (indeg.get(e.to) || 0) + 1); adj.get(e.from).push(e.to); }
  const stages = [];
  let frontier = roles.filter((s) => (indeg.get(s) || 0) === 0).sort();
  const placed = new Set();
  while (frontier.length) {
    stages.push([...frontier]);
    const next = [];
    for (const s of frontier) {
      placed.add(s);
      for (const m of adj.get(s) || []) { indeg.set(m, indeg.get(m) - 1); if (indeg.get(m) === 0) next.push(m); }
    }
    frontier = [...new Set(next)].filter((s) => !placed.has(s)).sort();
  }
  // Any roles left out by a dependency cycle (shouldn't happen) go in a final stage.
  const leftover = roles.filter((s) => !placed.has(s));
  if (leftover.length) stages.push(leftover);

  return {
    agents: roles.map((slug) => ({ slug })),
    plan: { stages, edges: edges.map((e) => ({ from: e.from, to: e.to, artifact: `${e.from}-report` })) },
    acceptanceCriteria: (plan.acceptanceCriteria || []).map((d, i) => ({ id: `ac-${i + 1}`, description: d })),
  };
}

export { tokenize, ROLE_KEYWORDS };
