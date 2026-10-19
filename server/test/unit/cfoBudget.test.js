import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocateBudget, RESERVE_RATIO } from '../../src/core/cfoBudget.js';

const team = [
  { slug: 'product-manager', name: 'Product Manager', departmentSlug: 'product-delivery' },
  { slug: 'backend-engineer', name: 'Backend Engineer', departmentSlug: 'software-engineering' },
  { slug: 'qa-engineer', name: 'QA Engineer', departmentSlug: 'qa-devops-cloud' },
  { slug: 'seo-specialist', name: 'SEO Specialist', departmentSlug: 'marketing-growth' },
];

test('shares plus reserve add up to the budget exactly (no lost cents)', () => {
  for (const total of [1, 3.33, 10, 7.77]) {
    const b = allocateBudget(team, total);
    const sumCents = b.allocations.reduce((s, a) => s + Math.round(a.maxCostUsd * 100), 0) + Math.round(b.reserveUsd * 100);
    assert.equal(sumCents, Math.round(total * 100), `total ${total}`);
  }
});

test('holds back the reserve', () => {
  const b = allocateBudget(team, 10);
  assert.equal(b.reserveUsd, 10 * RESERVE_RATIO);
  assert.equal(b.allocatedUsd, 9);
  assert.equal(b.approvedBy, 'cfo');
});

test('build roles get more than advisory roles', () => {
  const b = allocateBudget(team, 10);
  const share = (slug) => b.allocations.find((a) => a.slug === slug).maxCostUsd;
  assert.ok(share('backend-engineer') > share('qa-engineer'));
  assert.ok(share('qa-engineer') > share('product-manager'));
  assert.ok(share('product-manager') > share('seo-specialist'));
});

test('single role gets everything except the reserve', () => {
  const b = allocateBudget([team[3]], 2);
  assert.equal(b.allocations[0].maxCostUsd, 1.8);
});

test('rejects bad input instead of guessing', () => {
  assert.throws(() => allocateBudget([], 5), /no roles/);
  assert.throws(() => allocateBudget(team, 0), /positive/);
  assert.throws(() => allocateBudget(team, -1), /positive/);
  assert.throws(() => allocateBudget(team, 0.1), /too small/);
});
