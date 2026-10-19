// Structured outputs of workflow agents (docs/PHASES.md Phase 3). Every agent
// answers with ONE JSON object; it is parsed here and validated with zod
// before anything is applied. Invalid output → one retry with the errors →
// then BLOCKED (services/workflowAgents.js). Agent text is untrusted data.
import { z } from 'zod';

const text = (min, max = 4000) => z.string().trim().min(min).max(max);
// Phrases that are not acceptance criteria or evidence.
const GENERIC_CRITERION = /^(it |the (app|site|system|feature) )?(works?|is done|meets? (the )?requirements|functions? (correctly|properly)|all features work|as expected|good quality)\.?$/i;
const VAGUE_EVIDENCE = /^(ok|okay|pass(ed)?|done|fine|good|looks good|lgtm|yes|verified|tested|works|n\/a|-)\.?$/i;
const relPath = z.string().trim().min(1).max(400).refine((p) => !/^[A-Za-z]:[\\/]|^[\\/]{1,2}[^<]|^~/.test(p) && !/(^|[\\/])\.\.([\\/]|$)/.test(p), 'paths must be relative to the workspace (or start with <workspace>/), never absolute or containing ..');

const feature = z.object({ id: z.string().regex(/^F-\d{1,3}$/, 'feature ids look like F-1'), title: text(3, 200), description: text(10, 2000), priority: z.enum(['MUST', 'SHOULD', 'COULD']) });
const criterion = z.object({
  id: z.string().regex(/^AC-\d{1,3}$/, 'criterion ids look like AC-1'),
  featureId: z.string().regex(/^F-\d{1,3}$/),
  criterion: text(15, 600).refine((c) => !GENERIC_CRITERION.test(c), 'acceptance criteria must be specific and testable, not generic'),
  testMethod: text(5, 400),
});
const question = z.object({ id: z.string().regex(/^Q-\d{1,3}$/, 'question ids look like Q-1'), question: text(8, 600) });

export const baSpecSchema = z.object({
  summary: text(10, 2000),
  businessGoal: text(5, 1000),
  targetUsers: z.array(text(2, 200)).max(20).default([]),
  scope: z.object({ inScope: z.array(text(2, 300)).max(50).default([]), outOfScope: z.array(text(2, 300)).max(50).default([]) }),
  features: z.array(feature).max(50).default([]),
  acceptanceCriteria: z.array(criterion).max(100).default([]),
  // New questions only; answered ones from earlier rounds are kept by the platform.
  clarifyingQuestions: z.array(question).max(20).default([]),
  risks: z.array(text(3, 500)).max(30).default([]),
  assumptions: z.array(text(3, 500)).max(30).default([]),
  estimate: z.object({ effortHours: z.number().min(0).max(10000), costUSD: z.number().min(0).max(1_000_000), durationDays: z.number().min(0).max(3650), departmentsNeeded: z.array(z.string().regex(/^[a-z0-9-]{2,64}$/)).max(10).default([]) }),
  baRecommendation: z.enum(['ACCEPT', 'NEED_INFO', 'REJECT']),
  baReason: text(5, 2000),
}).superRefine((s, ctx) => {
  const issue = (path, message) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
  if (s.baRecommendation === 'NEED_INFO' && !s.clarifyingQuestions.length) issue(['clarifyingQuestions'], 'NEED_INFO requires at least one clarifying question');
  if (s.baRecommendation !== 'NEED_INFO' && s.clarifyingQuestions.length) issue(['baRecommendation'], 'open clarifying questions mean the recommendation must be NEED_INFO');
  if (s.baRecommendation === 'ACCEPT') {
    if (!s.features.length) issue(['features'], 'ACCEPT requires at least one feature');
    if (!s.acceptanceCriteria.length) issue(['acceptanceCriteria'], 'ACCEPT requires acceptance criteria');
  }
  const ids = new Set(s.features.map((f) => f.id));
  if (ids.size !== s.features.length) issue(['features'], 'duplicate feature ids');
  if (new Set(s.acceptanceCriteria.map((c) => c.id)).size !== s.acceptanceCriteria.length) issue(['acceptanceCriteria'], 'duplicate criterion ids');
  for (const [i, c] of s.acceptanceCriteria.entries()) if (!ids.has(c.featureId)) issue(['acceptanceCriteria', i, 'featureId'], `unknown feature ${c.featureId}`);
  for (const f of s.features.filter((x) => x.priority === 'MUST')) if (!s.acceptanceCriteria.some((c) => c.featureId === f.id)) issue(['features'], `MUST feature ${f.id} has no acceptance criterion`);
});

export const ceoBriefSchema = z.object({
  summary: text(20, 3000),
  risks: z.array(text(3, 500)).max(20).default([]),
  recommendedBudgetUSD: z.number().positive().max(1_000_000),
  recommendedPriority: z.enum(['P0', 'P1', 'P2', 'P3']),
  recommendation: z.enum(['APPROVE', 'REJECT', 'REQUEST_CHANGES']),
  rationale: text(10, 2000),
});

const planTask = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'task ids are short kebab-case, e.g. build-api'),
  title: text(3, 200),
  description: text(10, 3000),
  departmentSlug: z.string().regex(/^[a-z0-9-]{2,64}$/),
  requiredRole: z.string().regex(/^[a-z0-9-]{2,64}$/),
  dependsOn: z.array(z.string()).max(20).default([]),
  acceptanceCriteriaIds: z.array(z.string().regex(/^AC-\d{1,3}$/)).min(1, 'every task verifies at least one acceptance criterion').max(30),
  estimateHours: z.number().min(0).max(1000),
  budgetUSD: z.number().min(0).max(100_000),
  milestoneId: z.string().max(40).optional(),
});
export const pmPlanSchema = z.object({
  milestones: z.array(z.object({ id: z.string().max(40), title: text(3, 200), dueDate: z.string().date().optional() })).max(20).default([]),
  tasks: z.array(planTask).min(1).max(40),
});

export const headAssignSchema = z.object({ agentSlug: z.string().regex(/^[a-z0-9-]{2,64}$/), reason: text(10, 1000) });

export const headReviewSchema = z.object({
  verdict: z.enum(['PASS', 'FAIL']),
  comments: z.array(text(5, 1000)).min(1, 'a review needs at least one concrete comment').max(20),
});

export const specialistWorkSchema = z.object({
  summary: text(10, 4000),
  outputs: z.array(z.object({ type: z.enum(['file', 'text', 'link', 'test-report']), path: relPath.optional(), summary: text(3, 1000) })
    .refine((o) => o.type !== 'file' || !!o.path, 'file outputs need a path')).min(1).max(100),
  evidence: z.array(z.object({ type: text(2, 40), content: text(3, 8000).refine((c) => !VAGUE_EVIDENCE.test(c), 'evidence must show real output (test results, diff, lint), not a word like "ok"') })).min(1).max(30),
});

export const qaResultSchema = z.object({
  verdict: z.enum(['PASS', 'FAIL']),
  criteriaResults: z.array(z.object({
    criterionId: z.string().regex(/^AC-\d{1,3}$/),
    pass: z.boolean(),
    evidence: text(10, 4000).refine((e) => !VAGUE_EVIDENCE.test(e), 'evidence must show what was checked and the result'),
  })).min(1).max(100),
}).superRefine((q, ctx) => {
  const allPass = q.criteriaResults.every((r) => r.pass);
  if (q.verdict === 'PASS' && !allPass) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['verdict'], message: 'PASS requires every criterion to pass' });
  if (q.verdict === 'FAIL' && allPass) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['verdict'], message: 'FAIL requires at least one failed criterion' });
});

export const deliverableReportSchema = z.object({ summaryReport: text(30, 20000) });

export const OUTPUT_SCHEMAS = Object.freeze({
  'ba.analyse': baSpecSchema,
  'ceo.brief': ceoBriefSchema,
  'pm.plan': pmPlanSchema,
  'head.assign': headAssignSchema,
  'specialist.work': specialistWorkSchema,
  'head.review': headReviewSchema,
  'qa.verify': qaResultSchema,
  'pm.deliverable': deliverableReportSchema,
});

// Pull the JSON object out of an agent's final message: the last ```json
// fenced block, else the last balanced top-level {...}.
export function extractJson(raw) {
  const s = String(raw || '');
  const fences = [...s.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const candidates = fences.length ? fences.reverse() : [];
  if (!candidates.length) {
    let depth = 0; let start = -1; let inStr = false; let esc = false; let last = null;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '{') { if (depth === 0) start = i; depth++; } else if (ch === '}' && depth > 0) { depth--; if (depth === 0) last = s.slice(start, i + 1); }
    }
    if (last) candidates.push(last);
  }
  for (const c of candidates) {
    try { const v = JSON.parse(c.trim()); if (v && typeof v === 'object' && !Array.isArray(v)) return { ok: true, value: v }; } catch { /* try next */ }
  }
  return { ok: false, error: 'no JSON object found in the agent reply' };
}

export function parseAgentOutput(step, raw) {
  const schema = OUTPUT_SCHEMAS[step];
  if (!schema) return { ok: false, errors: [`unknown workflow step ${step}`] };
  const json = extractJson(raw);
  if (!json.ok) return { ok: false, errors: [json.error] };
  const parsed = schema.safeParse(json.value);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.slice(0, 20).map((i) => `${i.path.join('.') || 'output'}: ${i.message}`) };
  return { ok: true, data: parsed.data };
}
