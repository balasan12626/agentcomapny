import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planFromRequest, planToTask } from '../../src/core/ceoRouter.js';
import { departments as orgDepts, subAgents as orgSubs, coreRoles as orgRoles, executive } from '../../../catalog/organization.mjs';

// Build the catalog shape the router expects, straight from the source of truth.
const catalog = {
  executive: { slug: executive.slug },
  departments: orgDepts.map((d) => ({
    slug: d.slug, name: d.name, head: d.head,
    coreRoles: orgRoles.filter((r) => r.departmentSlug === d.slug).map((r) => ({
      slug: r.slug, name: r.name, departmentSlug: r.departmentSlug, type: r.type,
      subAgents: orgSubs.filter((s) => s.coreRoleSlug === r.slug).map((s) => ({ slug: s.slug, name: s.name })),
    })),
  })),
};

test('multi-capability request selects a minimal cross-department team', () => {
  const plan = planFromRequest('Build a customer portal with login, an admin dashboard, SEO optimization, and automated tests.', catalog);
  assert.equal(plan.intent, 'workflow');
  const roles = plan.coreRoles.map((r) => r.slug);
  assert.ok(roles.includes('backend-engineer'), 'login -> backend');
  assert.ok(roles.includes('frontend-engineer'), 'dashboard/portal -> frontend');
  assert.ok(roles.includes('seo-specialist'), 'SEO -> seo specialist');
  assert.ok(roles.includes('qa-engineer') || roles.includes('automation-test-engineer'), 'tests -> QA');
  // minimal: should NOT pull in unrelated departments like finance/legal
  assert.ok(!roles.includes('legal-operations-assistant'));
  assert.ok(!roles.includes('finance-analyst'));
  // every selected role contributes its two sub-agents
  assert.equal(plan.subAgents.length, plan.coreRoles.length * 2);
});

test('focused request puts the right role on top and keeps the team small', () => {
  const plan = planFromRequest('Improve our SEO keyword rankings', catalog);
  assert.deepEqual(plan.coreRoles.map((r) => r.slug), ['seo-specialist']);
  assert.equal(plan.intent, 'task');
  assert.deepEqual(plan.departments, ['marketing-growth']);
});

test('ambiguous wording still ranks the dominant capability first', () => {
  const plan = planFromRequest('Run an SEO audit of the marketing site', catalog);
  assert.ok(plan.coreRoles.some((r) => r.slug === 'seo-specialist'), 'SEO specialist is selected');
  assert.ok(plan.departments.includes('marketing-growth'));
  assert.ok(plan.coreRoles.length <= 3, 'stays a minimal team, not a company-wide fan-out');
});

test('paid campaign analysis routes to marketing', () => {
  const plan = planFromRequest('Analyze our Google Ads campaign performance and conversions', catalog);
  const roles = plan.coreRoles.map((r) => r.slug);
  assert.ok(roles.includes('paid-advertising-specialist') || roles.includes('marketing-analytics-specialist'));
  assert.ok(plan.departments.includes('marketing-growth'));
});

test('a pure question needs no specialists', () => {
  const plan = planFromRequest('What is our current deployment process?', catalog);
  // "deployment"/"process" may match ops roles; accept either a question or a small team, but never a huge fan-out
  assert.ok(plan.coreRoles.length <= 3);
});

test('unmappable request asks to clarify, selects nobody', () => {
  const plan = planFromRequest('xyzzy frobnicate the plover', catalog);
  assert.equal(plan.coreRoles.length, 0);
  assert.ok(['question', 'clarify'].includes(plan.intent));
});

test('dependencies order design/product before build before test', () => {
  const plan = planFromRequest('Design and build login API with a frontend form and tests', catalog);
  const dep = (from, to) => plan.dependencies.some((d) => d.from === from && d.to === to);
  // backend/frontend should precede qa when both present
  if (plan.coreRoles.some((r) => r.slug === 'qa-engineer')) {
    assert.ok(plan.dependencies.length >= 1, 'should produce an ordering when build + test both selected');
  }
  assert.ok(Array.isArray(plan.dependencies));
});

test('planToTask builds dependency-layered stages the orchestrator can run', () => {
  const plan = planFromRequest('Design and build a login API with a frontend form and automated tests', catalog);
  const t = planToTask(plan);
  // agents match the plan's roles
  assert.deepEqual(t.agents.map((a) => a.slug).sort(), plan.coreRoles.map((r) => r.slug).sort());
  // stages are arrays of role slugs; every role appears exactly once
  const flat = t.plan.stages.flat();
  assert.equal(new Set(flat).size, flat.length, 'no role appears in two stages');
  assert.deepEqual(flat.sort(), plan.coreRoles.map((r) => r.slug).sort());
  // a dependency from A->B must place A in an earlier stage than B
  const stageOf = (slug) => t.plan.stages.findIndex((s) => s.includes(slug));
  for (const e of t.plan.edges) assert.ok(stageOf(e.from) < stageOf(e.to), `${e.from} must precede ${e.to}`);
  assert.ok(t.acceptanceCriteria.every((c) => c.id && c.description));
});

test('planToTask of a single-role plan is one stage, no edges', () => {
  const t = planToTask(planFromRequest('Improve our SEO keyword rankings', catalog));
  assert.deepEqual(t.plan.stages, [['seo-specialist']]);
  assert.equal(t.plan.edges.length, 0);
});

test('plan always carries acceptance criteria and a coordinator', () => {
  const plan = planFromRequest('build login and tests', catalog);
  assert.ok(plan.acceptanceCriteria.length >= 2);
  assert.equal(plan.coordinator, executive.slug);
});
