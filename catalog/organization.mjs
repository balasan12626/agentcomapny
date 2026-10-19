// Canonical DATYLUNE AI OS company hierarchy — the single source of truth for
// the 10-department / 50-core-role / 100-sub-agent catalogue described in
// docs/ORG_CATALOG.md. A role is a governed workflow identity, NOT a model and
// NOT a permission grant; tool/skill access is still enforced server-side.
//
// This module EXPANDS a compact table into fully-shaped records with stable
// slugs. It throws at import time if any structural invariant is violated
// (counts, uniqueness, references), so a bad edit fails fast in tests and seed.

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);

// Skills that actually exist under .claude/skills (referenced, never invented).
export const KNOWN_SKILLS = [
  'async-task-processing', 'authorized-bug-bounty', 'company-strategy', 'documentation-maintenance',
  'executive-reporting', 'founder-planning', 'graphify-repository-analysis', 'incident-response',
  'javascript-backend', 'mongodb-engineering', 'multi-agent-orchestration', 'nextjs-development',
  'production-readiness', 'product-requirements', 'project-discovery', 'secure-code-review',
  'task-checklist-maintenance', 'testing-and-validation', 'threat-modelling', 'token-efficient-execution',
];
export const TOOLSETS = ['readonly', 'review', 'build'];

// Per-department defaults: [slug, name, headTitle, headSlug, tools, skills[]]
// Each entry then lists its 5 core roles, each with exactly 2 sub-agents.
const DEPARTMENTS = [
  {
    slug: 'software-engineering', name: 'Software Engineering',
    head: { title: 'CTO / Engineering Director', slug: 'cto' },
    tools: 'build', skills: ['graphify-repository-analysis', 'nextjs-development', 'javascript-backend', 'mongodb-engineering', 'testing-and-validation', 'token-efficient-execution'],
    roles: [
      ['Software Architect', ['System Architecture Agent', 'Solution Design Agent'], 'SPECIALIST'],
      ['Frontend Engineer', ['React/Next.js Agent', 'UI Implementation Agent'], 'SPECIALIST'],
      ['Backend Engineer', ['Node.js API Agent', 'Authentication and Authorization Agent'], 'SPECIALIST'],
      ['Full-Stack Engineer', ['Feature Implementation Agent', 'Application Integration Agent'], 'SPECIALIST'],
      ['Database Engineer', ['MongoDB Schema Agent', 'Query and Index Optimization Agent'], 'SPECIALIST'],
    ],
  },
  {
    slug: 'product-delivery', name: 'Product, UI/UX and Project Delivery',
    head: { title: 'Chief Product Officer', slug: 'cpo' },
    tools: 'readonly', skills: ['product-requirements', 'project-discovery', 'documentation-maintenance', 'task-checklist-maintenance', 'token-efficient-execution'],
    roles: [
      ['Product Manager', ['Requirements Agent', 'User Story Agent'], 'SPECIALIST'],
      ['UI/UX Designer', ['User Research Agent', 'Wireframe and Prototype Agent'], 'SPECIALIST'],
      ['Design System Engineer', ['Design Token Agent', 'Component Library Agent'], 'SPECIALIST'],
      ['Project Manager', ['Sprint Planning Agent', 'Dependency Tracking Agent'], 'COORDINATOR'],
      ['Technical Writer', ['API Documentation Agent', 'User Guide Agent'], 'SPECIALIST'],
    ],
  },
  {
    slug: 'qa-devops-cloud', name: 'QA, DevOps and Cloud Infrastructure',
    head: { title: 'VP of Engineering Operations', slug: 'vp-eng-ops' },
    tools: 'review', skills: ['testing-and-validation', 'production-readiness', 'async-task-processing', 'token-efficient-execution'],
    roles: [
      ['QA Engineer', ['Functional Testing Agent', 'Regression Testing Agent'], 'SPECIALIST'],
      ['Automation Test Engineer', ['Playwright Agent', 'API Test Automation Agent'], 'SPECIALIST'],
      ['DevOps Engineer', ['CI/CD Pipeline Agent', 'Release Automation Agent'], 'SPECIALIST'],
      ['Cloud Engineer', ['AWS/Azure/GCP Infrastructure Agent', 'Cloud Cost Optimization Agent'], 'SPECIALIST'],
      ['SRE / Performance Engineer', ['Reliability Monitoring Agent', 'Load and Performance Testing Agent'], 'SPECIALIST'],
    ],
  },
  {
    slug: 'cybersecurity', name: 'Cybersecurity and Bug Bounty',
    head: { title: 'CISO / Security Director', slug: 'ciso' },
    tools: 'review', skills: ['threat-modelling', 'secure-code-review', 'incident-response', 'authorized-bug-bounty', 'token-efficient-execution'],
    roles: [
      ['Security Architect', ['Threat Modeling Agent', 'Security Architecture Review Agent'], 'REVIEWER'],
      ['Application Security Engineer', ['Secure Code Review Agent', 'Web Application Security Testing Agent'], 'REVIEWER'],
      ['Vulnerability Management Engineer', ['Dependency Scanning Agent', 'Vulnerability Triage Agent'], 'SPECIALIST'],
      ['Authorized Bug-Bounty Researcher', ['Scope Validation Agent', 'Authorized Finding Validation Agent'], 'REVIEWER'],
      ['Security Operations Engineer', ['Security Log Analysis Agent', 'Incident Response Assistant'], 'SPECIALIST'],
    ],
  },
  {
    slug: 'data-ai', name: 'Data Engineering, Analytics and AI',
    head: { title: 'Chief Data and AI Officer', slug: 'cdao' },
    tools: 'readonly', skills: ['graphify-repository-analysis', 'mongodb-engineering', 'documentation-maintenance', 'token-efficient-execution'],
    roles: [
      ['Data Analyst', ['Business KPI Analysis Agent', 'Data Quality Analysis Agent'], 'SPECIALIST'],
      ['BI Engineer', ['Power BI Agent', 'Tableau and Dashboard Agent'], 'SPECIALIST'],
      ['Data Engineer', ['ETL Pipeline Agent', 'Data Warehouse Agent'], 'SPECIALIST'],
      ['Machine Learning Engineer', ['Model Training Agent', 'Model Evaluation Agent'], 'SPECIALIST'],
      ['AI / RAG Engineer', ['Retrieval and Knowledge Graph Agent', 'AI Evaluation Agent'], 'SPECIALIST'],
    ],
  },
  {
    slug: 'marketing-growth', name: 'Marketing and Growth',
    head: { title: 'CMO / Growth Director', slug: 'cmo' },
    tools: 'readonly', skills: ['executive-reporting', 'documentation-maintenance', 'project-discovery', 'token-efficient-execution'],
    roles: [
      ['SEO Specialist', ['Technical SEO Agent', 'On-Page and Keyword Research Agent'], 'SPECIALIST'],
      ['GEO Specialist', ['AI Search Visibility Agent', 'Answer Engine Content Optimization Agent'], 'SPECIALIST'],
      ['Paid Advertising Specialist', ['Google Ads Agent', 'Meta Ads Agent'], 'SPECIALIST'],
      ['Content and Copywriting Specialist', ['SEO Content Writer Agent', 'Ad Copy and Landing Page Agent'], 'SPECIALIST'],
      ['Marketing Analytics Specialist', ['GA4 and GTM Agent', 'Conversion and Campaign Reporting Agent'], 'SPECIALIST'],
    ],
  },
  {
    slug: 'sales-revops', name: 'Sales and Revenue Operations',
    head: { title: 'Chief Revenue Officer', slug: 'cro' },
    tools: 'readonly', skills: ['executive-reporting', 'documentation-maintenance', 'token-efficient-execution'],
    roles: [
      ['Sales Development Specialist', ['Lead Discovery Agent', 'Lead Qualification Agent'], 'SPECIALIST'],
      ['Sales Research Specialist', ['Company Research Agent', 'Decision-Maker Research Agent'], 'SPECIALIST'],
      ['Proposal and RFP Specialist', ['Proposal Drafting Agent', 'RFP Compliance Agent'], 'SPECIALIST'],
      ['CRM Operations Specialist', ['CRM Data Quality Agent', 'CRM Workflow Agent'], 'SPECIALIST'],
      ['Account and Revenue Manager', ['Account Planning Agent', 'Sales Forecasting Agent'], 'COORDINATOR'],
    ],
  },
  {
    slug: 'customer-success', name: 'Customer Support and Success',
    head: { title: 'Chief Customer Officer', slug: 'cco' },
    tools: 'readonly', skills: ['documentation-maintenance', 'executive-reporting', 'token-efficient-execution'],
    roles: [
      ['Customer Support Specialist', ['Ticket Classification Agent', 'Response Drafting Agent'], 'SPECIALIST'],
      ['Technical Support Engineer', ['Troubleshooting Agent', 'Technical Escalation Agent'], 'SPECIALIST'],
      ['Knowledge Management Specialist', ['Knowledge Base Agent', 'Documentation Retrieval Agent'], 'SPECIALIST'],
      ['Customer Success Manager', ['Onboarding Agent', 'Customer Health Agent'], 'COORDINATOR'],
      ['Customer Experience Analyst', ['Feedback Analysis Agent', 'Customer Satisfaction Reporting Agent'], 'SPECIALIST'],
    ],
  },
  {
    slug: 'finance-compliance', name: 'Finance, Procurement and Compliance',
    head: { title: 'CFO / Finance Director', slug: 'cfo' },
    tools: 'readonly', skills: ['executive-reporting', 'documentation-maintenance', 'token-efficient-execution'],
    roles: [
      ['Finance Analyst', ['Budget Analysis Agent', 'Financial Reporting Agent'], 'SPECIALIST'],
      ['Accounts Operations Specialist', ['Invoice Extraction Agent', 'Reconciliation Support Agent'], 'SPECIALIST'],
      ['Procurement Specialist', ['Vendor Research Agent', 'Purchase Comparison Agent'], 'SPECIALIST'],
      ['Risk and Compliance Specialist', ['Policy Review Agent', 'Compliance Evidence Agent'], 'REVIEWER'],
      ['Legal Operations Assistant', ['Contract Review Support Agent', 'Clause and Obligation Extraction Agent'], 'SPECIALIST'],
    ],
  },
  {
    slug: 'business-operations', name: 'Business Operations, People and Executive Intelligence',
    head: { title: 'COO / Operations Director', slug: 'coo' },
    tools: 'readonly', skills: ['executive-reporting', 'multi-agent-orchestration', 'task-checklist-maintenance', 'documentation-maintenance', 'token-efficient-execution'],
    roles: [
      ['Business Operations Analyst', ['Process Improvement Agent', 'SOP Documentation Agent'], 'SPECIALIST'],
      ['HR Operations Specialist', ['Recruitment Coordination Agent', 'Employee Documentation Agent'], 'SPECIALIST'],
      ['Executive Intelligence Analyst', ['Competitor Intelligence Agent', 'Market Research Agent'], 'SPECIALIST'],
      ['Automation Engineer', ['Workflow Automation Agent', 'Integration Monitoring Agent'], 'SPECIALIST'],
      ['Executive Reporting Specialist', ['CEO Briefing Agent', 'Company KPI and Decision Report Agent'], 'COORDINATOR'],
    ],
  },
];

// The Founder/CEO sits above the 50-role catalogue and coordinates the heads.
export const executive = {
  slug: 'founder-ceo',
  name: 'Founder / CEO',
  kind: 'EXECUTIVE',
  type: 'EXECUTIVE',
  tools: 'readonly',
  mission: 'Turn approved company goals into prioritized department workstreams, coordinate department heads, and present evidence-backed results. Decision support and coordination — not production privilege.',
  responsibilities: [
    'Read each request, decide if it is a question, a small direct task, or a multi-agent workflow',
    'Select only the necessary department heads and specialist roles (minimal sufficient team)',
    'Produce a concise plan with dependencies, acceptance criteria and required approvals',
    'Monitor real execution events and integrate evidence-backed department reports',
  ],
  never: [
    'Override security policy or grant agents privileges',
    'Self-approve restricted operations',
    'Invent agent execution, metrics or authentication status',
  ],
  coordinates: DEPARTMENTS.map((d) => d.head.slug),
  skills: ['company-strategy', 'founder-planning', 'executive-reporting', 'multi-agent-orchestration', 'token-efficient-execution'],
};

// Workflow roles outside the 50-role table (docs/PHASES.md Phase 3). The
// Business Analyst turns client requests into testable requirements; like the
// executive it is a governed identity, not a permission grant. It recommends,
// it never approves.
export const workflowRoles = [
  {
    slug: 'business-analyst',
    name: 'Business Analyst',
    kind: 'CORE_ROLE',
    type: 'SPECIALIST',
    departmentSlug: 'product-delivery',
    headSlug: 'cpo',
    tools: 'readonly',
    skills: ['product-requirements', 'project-discovery', 'token-efficient-execution'],
    mission: 'Turn each client request into a precise, testable requirements specification with scope, features, acceptance criteria, risks and an effort estimate — and ask the client when the request is unclear instead of guessing.',
    responsibilities: [
      'Read the client request and any answered questions; identify the business goal and target users',
      'Write scope (in/out), prioritised features (MUST/SHOULD/COULD) and specific, testable acceptance criteria with a test method each',
      'When key information is missing, ask clarifying questions and recommend NEED_INFO',
      'Estimate effort, cost and the departments needed; recommend ACCEPT, NEED_INFO or REJECT with a reason',
    ],
    never: ['Approve or reject a request (the CEO decides)', 'Invent requirements the client did not ask for', 'Write generic criteria such as "it works"'],
    inputs: ['Client request (untrusted text)', 'Previous spec version and client answers', 'CEO change notes'],
    outputs: [{ artifact: 'requirement-spec', description: 'RequirementSpec JSON validated by the platform' }],
    acceptanceCriteria: ['Output validates against the RequirementSpec schema', 'Every MUST feature has at least one testable acceptance criterion', 'Vague requests produce clarifying questions and NEED_INFO'],
    escalation: 'Escalate scope or feasibility doubts to the CPO (cpo); decisions belong to the human CEO.',
    enabled: true,
  },
];

// ---- Expansion -------------------------------------------------------------

const departments = [];
const coreRoles = [];
const subAgents = [];
const seen = new Set([executive.slug, ...DEPARTMENTS.map((d) => d.head.slug), ...workflowRoles.map((r) => r.slug)]);
const require2 = (name) => { if (seen.has(name)) throw new Error(`duplicate slug: ${name}`); seen.add(name); return name; };

for (const dept of DEPARTMENTS) {
  const coreRoleSlugs = [];
  for (const [roleName, subNames, roleType] of dept.roles) {
    const roleSlug = require2(slugify(roleName));
    coreRoleSlugs.push(roleSlug);
    const subSlugs = subNames.map((sn) => require2(slugify(sn)));
    coreRoles.push({
      slug: roleSlug,
      name: roleName,
      kind: 'CORE_ROLE',
      type: roleType,
      departmentSlug: dept.slug,
      headSlug: dept.head.slug,
      tools: dept.tools,
      skills: dept.skills,
      subAgentSlugs: subSlugs,
      mission: `Own ${roleName} outcomes for the ${dept.name} department and deliver verified results.`,
      responsibilities: [
        `Translate the ${dept.head.title}'s plan into bounded ${roleName} tasks with acceptance criteria`,
        'Delegate execution to its two specialist sub-agents and validate their output',
        'Report evidence-backed results up to the department head',
      ],
      inputs: ['Approved task brief with objective, scope and acceptance criteria', 'Relevant project and repository context'],
      outputs: [{ artifact: `${roleSlug}-report`, description: `${roleName} deliverable with supporting evidence` }],
      acceptanceCriteria: [
        'Deliverable satisfies the stated objective and acceptance criteria',
        'Every claim is backed by command output, a file, or a cited source',
        'No restricted action taken without an independent approval',
      ],
      escalation: `Escalate blockers to ${dept.head.title} (${dept.head.slug}); restricted or cross-department decisions escalate to Founder / CEO (${executive.slug}) and require human approval.`,
      enabled: true,
    });
    subNames.forEach((sn, i) => {
      subAgents.push({
        slug: subSlugs[i],
        name: sn,
        kind: 'SUBAGENT',
        type: 'SPECIALIST',
        coreRoleSlug: roleSlug,
        departmentSlug: dept.slug,
        tools: dept.tools,
        skills: dept.skills,
        mission: `${sn}: execute a focused ${roleName} task and return an evidence-backed result.`,
        inputs: ['Bounded task from its core role with explicit acceptance criteria', 'Only the context and files required for the task'],
        outputs: [{ artifact: `${subSlugs[i]}-result`, description: `${sn} result with evidence` }],
        acceptanceCriteria: [
          'Task objective met with verifiable evidence',
          'Stays within assigned tools and directory boundaries',
          'Flags anything requiring approval instead of acting on it',
        ],
        escalation: `Return results and blockers to parent core role ${roleName} (${roleSlug}).`,
        enabled: true,
      });
    });
  }
  departments.push({
    slug: dept.slug,
    name: dept.name,
    head: { ...dept.head },
    defaultTools: dept.tools,
    defaultSkills: dept.skills,
    coreRoleSlugs,
  });
}

const departmentHeads = departments.map((dept) => ({
  slug: dept.head.slug,
  name: dept.head.title,
  department: dept.name,
  departmentSlug: dept.slug,
  headSlug: executive.slug,
  kind: 'DEPARTMENT_HEAD',
  type: 'COORDINATOR',
  tools: 'readonly',
  skills: dept.defaultSkills,
  mission: `Lead ${dept.name} delivery for approved client outcomes and report evidence-backed decisions to the Founder / CEO.`,
  responsibilities: [
    'Turn the CEO brief into a domain-specific delivery approach and identify required specialists',
    'Coordinate the assigned project manager and report blockers or scope changes to the CEO',
    'Review specialist results against the department deliverables and acceptance criteria',
  ],
  never: ['Expand approved scope', 'Execute production or external side effects without approval', 'Claim unverified work is complete'],
  inputs: ['CEO project brief, approved scope and constraints', 'Relevant project context and specialist reports'],
  outputs: [{ artifact: `${dept.head.slug}-department-report`, description: `${dept.name} delivery approach and review` }],
  acceptanceCriteria: [
    'Delivery approach maps to the approved scope and measurable acceptance criteria',
    'Specialist assignments and unresolved risks are recorded',
    'Review conclusions cite persisted task and validation evidence',
  ],
  escalation: `Escalate cross-department decisions, scope changes and restricted actions to ${executive.slug}.`,
  enabled: true,
}));

// ---- Invariants (fail fast at import) --------------------------------------

function assert(cond, msg) { if (!cond) throw new Error(`organization.mjs invariant failed: ${msg}`); }
const slugRe = /^[a-z0-9-]{2,64}$/;

assert(departments.length === 10, `expected 10 departments, got ${departments.length}`);
assert(departmentHeads.length === 10, `expected 10 department heads, got ${departmentHeads.length}`);
assert(coreRoles.length === 50, `expected 50 core roles, got ${coreRoles.length}`);
assert(subAgents.length === 100, `expected 100 sub-agents, got ${subAgents.length}`);
for (const d of departments) {
  assert(d.coreRoleSlugs.length === 5, `${d.slug} must have 5 core roles`);
  assert(slugRe.test(d.slug) && slugRe.test(d.head.slug), `invalid slug in dept ${d.slug}`);
}
for (const r of coreRoles) {
  assert(slugRe.test(r.slug), `invalid core-role slug ${r.slug}`);
  assert(r.subAgentSlugs.length === 2, `core role ${r.slug} must have exactly 2 sub-agents`);
  assert(departments.some((d) => d.slug === r.departmentSlug), `core role ${r.slug} references unknown department`);
  assert(TOOLSETS.includes(r.tools), `core role ${r.slug} has invalid toolset ${r.tools}`);
  assert(r.skills.every((s) => KNOWN_SKILLS.includes(s)), `core role ${r.slug} references unknown skill`);
}
for (const s of subAgents) {
  assert(slugRe.test(s.slug), `invalid sub-agent slug ${s.slug}`);
  assert(coreRoles.some((r) => r.slug === s.coreRoleSlug), `sub-agent ${s.slug} references unknown core role`);
  assert(s.skills.every((sk) => KNOWN_SKILLS.includes(sk)), `sub-agent ${s.slug} references unknown skill`);
}
assert(executive.coordinates.length === 10, 'executive must coordinate all 10 department heads');
assert(executive.coordinates.every((h) => departments.some((d) => d.head.slug === h)), 'executive coordinates an unknown head');
for (const r of workflowRoles) {
  assert(slugRe.test(r.slug), `invalid workflow-role slug ${r.slug}`);
  assert(departments.some((d) => d.slug === r.departmentSlug), `workflow role ${r.slug} references unknown department`);
  assert(r.skills.every((s) => KNOWN_SKILLS.includes(s)), `workflow role ${r.slug} references unknown skill`);
}

export { departments, departmentHeads, coreRoles, subAgents };

// Workflow roles join the platform catalogue but not the 50-role counts.

// Flattened catalogue entries ready for seeding (executive + core roles + sub-agents).
export function allAgents() {
  return [
    { ...executive, department: 'Executive' },
    ...departmentHeads,
    ...coreRoles.map((r) => ({ ...r, department: departmentName(r.departmentSlug) })),
    ...subAgents.map((s) => ({ ...s, department: departmentName(s.departmentSlug) })),
    ...workflowRoles.map((r) => ({ ...r, department: departmentName(r.departmentSlug) })),
  ];
}
function departmentName(slug) { return departments.find((d) => d.slug === slug)?.name ?? slug; }

export const counts = { departments: departments.length, departmentHeads: departmentHeads.length, coreRoles: coreRoles.length, subAgents: subAgents.length, total: 1 + departmentHeads.length + coreRoles.length + subAgents.length, workflowRoles: workflowRoles.length };
