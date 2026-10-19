import { test } from 'node:test';
import assert from 'node:assert/strict';
import { departments, coreRoles, subAgents, executive, counts, allAgents, KNOWN_SKILLS, TOOLSETS } from '../../../catalog/organization.mjs';

const slugRe = /^[a-z0-9-]{2,64}$/;

test('exactly 10 departments, 50 core roles, 100 sub-agents', () => {
  assert.equal(departments.length, 10);
  assert.equal(coreRoles.length, 50);
  assert.equal(subAgents.length, 100);
  assert.deepEqual(counts, { departments: 10, coreRoles: 50, subAgents: 100, total: 151 });
});

test('every core role has exactly two sub-agents', () => {
  for (const r of coreRoles) {
    assert.equal(r.subAgentSlugs.length, 2, `${r.slug} should have 2 sub-agents`);
    const kids = subAgents.filter((s) => s.coreRoleSlug === r.slug);
    assert.equal(kids.length, 2, `${r.slug} should own 2 sub-agents`);
    assert.deepEqual(kids.map((k) => k.slug).sort(), [...r.subAgentSlugs].sort());
  }
});

test('every department has 5 core roles and a head', () => {
  for (const d of departments) {
    assert.equal(d.coreRoleSlugs.length, 5, `${d.slug} should have 5 core roles`);
    assert.ok(d.head?.slug && d.head?.title, `${d.slug} missing head`);
    assert.equal(coreRoles.filter((r) => r.departmentSlug === d.slug).length, 5);
  }
  // 10 departments x 5 roles = 50
  assert.equal(departments.reduce((n, d) => n + d.coreRoleSlugs.length, 0), 50);
});

test('all IDs/slugs are unique and valid', () => {
  const all = [executive.slug, ...departments.map((d) => d.slug), ...departments.map((d) => d.head.slug), ...coreRoles.map((r) => r.slug), ...subAgents.map((s) => s.slug)];
  // department heads repeat across? no — each head belongs to one department; slugs must be globally unique among roles/subs/exec.
  const roleSlugs = [executive.slug, ...coreRoles.map((r) => r.slug), ...subAgents.map((s) => s.slug)];
  assert.equal(new Set(roleSlugs).size, roleSlugs.length, 'agent slugs must be unique');
  assert.equal(new Set(departments.map((d) => d.slug)).size, 10, 'department slugs must be unique');
  for (const s of all) assert.ok(slugRe.test(s), `slug "${s}" must match ${slugRe}`);
});

test('relationships resolve: sub-agent -> core role -> department -> head', () => {
  for (const s of subAgents) {
    const role = coreRoles.find((r) => r.slug === s.coreRoleSlug);
    assert.ok(role, `sub-agent ${s.slug} must reference a real core role`);
    const dept = departments.find((d) => d.slug === role.departmentSlug);
    assert.ok(dept, `core role ${role.slug} must reference a real department`);
    assert.equal(s.departmentSlug, dept.slug);
    assert.equal(role.headSlug, dept.head.slug);
  }
});

test('skills reference only existing skills; tools use a known toolset', () => {
  for (const a of [executive, ...coreRoles, ...subAgents]) {
    for (const sk of a.skills) assert.ok(KNOWN_SKILLS.includes(sk), `${a.slug} references unknown skill ${sk}`);
  }
  for (const a of [...coreRoles, ...subAgents]) assert.ok(TOOLSETS.includes(a.tools), `${a.slug} invalid tools`);
});

test('Founder/CEO coordinates all 10 department heads and no production privilege', () => {
  assert.equal(executive.coordinates.length, 10);
  assert.deepEqual([...executive.coordinates].sort(), departments.map((d) => d.head.slug).sort());
  assert.equal(executive.tools, 'readonly');
});

test('every role carries responsibilities, acceptance criteria and escalation', () => {
  for (const r of coreRoles) {
    assert.ok(r.mission && r.responsibilities.length >= 2, `${r.slug} needs responsibilities`);
    assert.ok(r.acceptanceCriteria.length >= 2 && r.escalation.includes(executive.slug), `${r.slug} needs escalation to CEO`);
    assert.ok(r.inputs.length && r.outputs.length);
  }
  for (const s of subAgents) {
    assert.ok(s.mission && s.acceptanceCriteria.length >= 2 && s.escalation.includes(s.coreRoleSlug));
  }
});

test('allAgents() flattens to 151 entries with department names', () => {
  const flat = allAgents();
  assert.equal(flat.length, 151);
  assert.ok(flat.every((a) => typeof a.department === 'string' && a.department.length));
  assert.equal(flat.filter((a) => a.kind === 'EXECUTIVE').length, 1);
  assert.equal(flat.filter((a) => a.kind === 'CORE_ROLE').length, 50);
  assert.equal(flat.filter((a) => a.kind === 'SUBAGENT').length, 100);
});
