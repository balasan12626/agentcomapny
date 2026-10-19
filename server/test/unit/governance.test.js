import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRoot, rootsOverlap, validateRootShape, findWorkspaceConflicts, defaultWorkspaceRoot } from '../../src/core/workspaceIsolation.js';
import { detectStalls, workerStatus } from '../../src/core/staleness.js';
import { redact, redactPaths, redactPathsDeep } from '../../src/core/redact.js';
import { canTransition, assertTransition } from '../../src/core/taskStateMachine.js';
import { planFromRequest, planToTask } from '../../src/core/ceoRouter.js';
import { evaluateCriteria } from '../../src/services/orchestrator.js';
import { departments as orgDepts, subAgents as orgSubs, coreRoles as orgRoles, executive } from '../../../catalog/organization.mjs';

const win = { win: true };
const posix = { win: false };

test('workspace roots: equal, parent and child overlap; siblings do not', () => {
  assert.equal(rootsOverlap('C:\\ws\\demo', 'c:\\WS\\demo\\', win), true, 'case + trailing slash');
  assert.equal(rootsOverlap('C:\\ws', 'C:\\ws\\demo', win), true, 'parent contains child');
  assert.equal(rootsOverlap('C:\\ws\\demo\\api', 'C:\\ws\\demo', win), true, 'child inside parent');
  assert.equal(rootsOverlap('C:\\ws\\demo', 'C:\\ws\\demo-2', win), false, 'prefix sibling is not inside');
  assert.equal(rootsOverlap('/srv/a', '/srv/a/../a/', posix), true, 'normalized traversal still compared');
  assert.equal(rootsOverlap('/srv/a', '/srv/b', posix), false);
  assert.equal(normalizeRoot('C:/Work/X/', win), 'c:\\work\\x');
});

test('workspace roots: unsafe shapes are rejected', () => {
  const opts = { win: true, home: 'C:\\Users\\me', protectedRoots: ['D:\\it agent\\agentcomapny'] };
  assert.match(validateRootShape('relative\\dir', opts), /absolute/);
  assert.match(validateRootShape('C:\\ws\\..\\other', opts), /\.\./);
  assert.match(validateRootShape('C:\\', opts), /drive or filesystem root/);
  assert.match(validateRootShape('C:\\Users\\me', opts), /home folder/);
  assert.match(validateRootShape('D:\\it agent\\agentcomapny\\web', opts), /DATYLUNE application/);
  assert.match(validateRootShape('D:\\it agent', opts), /DATYLUNE application/, 'a parent of the app is also refused');
  assert.equal(validateRootShape('C:\\Users\\me\\workspaces\\acme\\site', opts), null);
});

test('workspace conflicts name the other project and its root', () => {
  const others = [{ _id: 'p1', name: 'Shop', organizationId: 'o1', workspace: { allowedRoots: ['C:\\ws\\shop'] } }, { _id: 'p2', name: 'Blog', workspace: { allowedRoots: ['C:\\ws\\blog'] } }];
  const c = findWorkspaceConflicts(['C:\\ws\\shop\\admin'], others, win);
  assert.deepEqual(c.map((x) => x.projectName), ['Shop']);
  assert.deepEqual(findWorkspaceConflicts(['C:\\ws\\crm'], others, win), []);
  assert.equal(defaultWorkspaceRoot({ base: 'C:\\ws', clientName: 'Acme Corp', projectName: 'Web App!', win: true }), 'C:\\ws\\acme-corp\\web-app');
  assert.equal(defaultWorkspaceRoot({ base: '', clientName: 'a', projectName: 'b' }), null);
});

test('stall detection: queued with no worker, orphaned job, dead mid-run worker', () => {
  const now = Date.parse('2026-10-19T20:00:00Z');
  const ago = (m) => new Date(now - m * 60_000);
  const tasks = [
    { _id: 'q-fresh', status: 'QUEUED', updatedAt: ago(2) },
    { _id: 'q-old', status: 'QUEUED', updatedAt: ago(80) },
    { _id: 'run-idle', status: 'RUNNING', updatedAt: ago(9) },
    { _id: 'done', status: 'COMPLETED', updatedAt: ago(500) },
  ];
  const offline = detectStalls(tasks, { now, workerOnline: false });
  assert.deepEqual(offline.map((s) => s.taskId), ['q-old', 'run-idle']);
  assert.match(offline[0].reason, /queued for 80 min and no execution worker is online/);
  const online = detectStalls(tasks, { now, workerOnline: true });
  assert.deepEqual(online.map((s) => s.taskId), ['q-old'], 'running tasks are left to the live worker; an 80-min queue means a lost job');
  assert.match(online[0].reason, /missing from the queue/);
});

test('worker status from heartbeats', () => {
  const now = Date.parse('2026-10-19T20:00:00Z');
  assert.equal(workerStatus([], now).status, 'NEVER_SEEN');
  assert.equal(workerStatus([{ lastSeenAt: new Date(now - 120_000) }], now).status, 'OFFLINE');
  const s = workerStatus([{ lastSeenAt: new Date(now - 5_000), activeJobs: 1, concurrency: 3 }], now);
  assert.deepEqual({ status: s.status, activeJobs: s.activeJobs, capacity: s.capacity }, { status: 'ONLINE', activeJobs: 1, capacity: 3 });
});

test('STALLED is reachable from worker states and only leaves via retry, fail or cancel', () => {
  for (const from of ['QUEUED', 'PLANNING', 'RUNNING', 'VALIDATING']) assert.equal(canTransition(from, 'STALLED'), true, from);
  assert.equal(canTransition('COMPLETED', 'STALLED'), false);
  assert.equal(canTransition('STALLED', 'QUEUED'), true);
  assert.equal(canTransition('STALLED', 'RUNNING'), false);
  assert.throws(() => assertTransition({ status: 'STALLED' }, 'COMPLETED'), /Invalid task transition/);
});

test('absolute workspace and home paths are redacted from reports', () => {
  const root = 'C:\\Users\\ASUS\\datylune-workspace\\demo';
  const text = 'Wrote C:\\Users\\ASUS\\datylune-workspace\\demo\\server.js and c:/users/asus/datylune-workspace/demo/README.md; log at C:\\Users\\ASUS\\AppData\\x.log';
  const out = redactPaths(text, [root]);
  assert.equal(out, 'Wrote <workspace>\\server.js and <workspace>/README.md; log at ~\\AppData\\x.log');
  assert.equal(redact('see /home/alice/project and /Users/bob/x'), 'see ~/project and ~/x');
  assert.deepEqual(redactPathsDeep({ a: ['C:\\Users\\ASUS\\datylune-workspace\\demo\\a.js'], n: 3 }, [root]), { a: ['<workspace>\\a.js'], n: 3 });
});

const catalog = {
  executive: { slug: executive.slug },
  departments: orgDepts.map((d) => ({
    slug: d.slug, name: d.name, head: d.head,
    coreRoles: orgRoles.filter((r) => r.departmentSlug === d.slug).map((r) => ({ slug: r.slug, name: r.name, departmentSlug: r.departmentSlug, type: r.type, subAgents: orgSubs.filter((s) => s.coreRoleSlug === r.slug).map((s) => ({ slug: s.slug, name: s.name })) })),
  })),
};

test('CEO plans carry task-specific, verifiable acceptance criteria', () => {
  const plan = planFromRequest('Build a login API with a frontend form and automated tests', catalog);
  const t = planToTask(plan);
  const roleCriteria = t.acceptanceCriteria.filter((c) => c.role);
  assert.deepEqual(roleCriteria.map((c) => c.role).sort(), plan.coreRoles.map((r) => r.slug).sort(), 'one criterion per selected role');
  assert.ok(roleCriteria.every((c) => c.verification === 'AGENT_RUN' && c.description.includes('login API')), 'criteria quote the request');
  assert.ok(t.acceptanceCriteria.some((c) => c.check === 'approvals' && c.verification === 'AUTOMATED'));
  assert.ok(!t.acceptanceCriteria.some((c) => /Restricted actions require/.test(c.description)), 'no generic boilerplate');
});

test('criteria are judged per role and from recorded timestamps, not "all exited"', () => {
  const t0 = new Date('2026-10-19T10:00:00Z');
  const at = (s) => new Date(t0.getTime() + s * 1000);
  const criteria = [
    { id: 'ac-1', verification: 'AGENT_RUN', role: 'backend-engineer' },
    { id: 'ac-2', verification: 'AGENT_RUN', role: 'qa-engineer' },
    { id: 'ac-3', verification: 'AUTOMATED', check: 'dependency_order' },
    { id: 'ac-4', verification: 'AUTOMATED', check: 'approvals' },
    { id: 'ac-5', verification: 'AUTOMATED' },
  ];
  const results = [
    { slug: 'backend-engineer', ok: true, summary: 'Added /login, tests pass', runId: 'aaaaaa111111', sessionId: 'sess1234abcd', startedAt: at(0), finishedAt: at(10) },
    { slug: 'qa-engineer', ok: true, summary: '   ', runId: 'bbbbbb222222', startedAt: at(11), finishedAt: at(20) },
  ];
  const out = Object.fromEntries(evaluateCriteria({ criteria, results, edges: [{ from: 'backend-engineer', to: 'qa-engineer' }], approvals: [] }).map((v) => [v.id, v]));
  assert.equal(out['ac-1'].status, 'PASSED');
  assert.match(out['ac-1'].evidence, /run 111111 · session sess1234 · finished: "Added \/login/);
  assert.equal(out['ac-2'].status, 'FAILED', 'an empty report is not evidence');
  assert.equal(out['ac-3'].status, 'PASSED');
  assert.equal(out['ac-4'].status, 'PASSED');
  assert.match(out['ac-4'].evidence, /no approval-gated operation/);
  assert.equal(out['ac-5'], undefined, 'unnamed automated checks stay for a validator/reviewer');
  const reversed = evaluateCriteria({ criteria: [criteria[2]], results: [{ ...results[0], finishedAt: at(15) }, results[1]], edges: [{ from: 'backend-engineer', to: 'qa-engineer' }] });
  assert.equal(reversed[0].status, 'FAILED', 'dependent started before its input finished');
  const rejected = evaluateCriteria({ criteria: [criteria[3]], results, approvals: [{ status: 'REJECTED' }] });
  assert.equal(rejected[0].status, 'FAILED');
});
