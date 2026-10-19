// Requires MongoDB: set MONGODB_TEST_URI, or have mongodb-memory-server able
// to download a binary. Skips (does NOT pass) otherwise.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.SESSION_SECRET = 'test-secret-'.padEnd(40, 'x');
process.env.NODE_ENV = 'test';

let mem;
let skip = false;
let app;
const enqueued = [];
const H = { 'x-datylune-csrf': '1' };
// Every project gets its own folder: shared roots are rejected by workspace isolation.
const ws = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dl-it-'));
// Dispatch is refused without a live worker; tests simulate one with a heartbeat row.
const workerOnline = async () => {
  const M = await import('../../src/models/index.js');
  await M.WorkerHeartbeat.updateOne({ workerId: 'it-worker' }, { $set: { host: 'test', pid: 1, startedAt: new Date(), lastSeenAt: new Date(Date.now() + 3600_000), concurrency: 1, activeJobs: 0 } }, { upsert: true });
};
const workerOffline = async () => { const M = await import('../../src/models/index.js'); await M.WorkerHeartbeat.deleteMany({}); };
// Absolute paths a response must never carry (Windows drive, UNC, POSIX temp/home).
// Workspace managers legitimately see `allowedRoots` on the project setting.
const PATH_LEAK = /[A-Za-z]:(\\\\|\/)|\/(tmp|home|Users|var\/folders)\//;
const leaks = (body) => PATH_LEAK.test(JSON.stringify(body, (k, v) => (k === 'allowedRoots' ? undefined : v)));

before(async () => {
  let uri = process.env.MONGODB_TEST_URI;
  if (!uri) {
    try {
      const { MongoMemoryReplSet } = await import('mongodb-memory-server');
      mem = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
      uri = mem.getUri();
    } catch (err) {
      skip = `MongoDB unavailable: ${err.message.split('\n')[0]}`;
      return;
    }
  }
  await mongoose.connect(uri);
  await mongoose.connection.db.dropDatabase();
  const { createApp } = await import('../../src/http/app.js');
  app = createApp({ enqueue: async (j) => enqueued.push(j) });
  await workerOnline();
});
after(async () => { if (mongoose.connection.readyState) await mongoose.disconnect(); await mem?.stop(); });

async function seed() {
  const M = await import('../../src/models/index.js');
  const { hashPassword } = await import('../../src/core/session.js');
  const [orgA, orgB] = await M.Organization.create([{ name: 'A', slug: 'org-a' }, { name: 'B', slug: 'org-b' }]);
  const [op, rev, other] = await M.User.create([
    { email: 'op@a.test', passwordHash: hashPassword('password-op') },
    { email: 'rev@a.test', passwordHash: hashPassword('password-rev') },
    { email: 'b@b.test', passwordHash: hashPassword('password-b') },
  ]);
  await M.Membership.create([
    { organizationId: orgA._id, userId: op._id, role: 'AGENT_OPERATOR' },
    { organizationId: orgA._id, userId: rev._id, role: 'REVIEWER' },
    { organizationId: orgB._id, userId: other._id, role: 'ORG_ADMIN' },
  ]);
  const project = await M.Project.create({ organizationId: orgA._id, name: 'P', workspace: { allowedRoots: [ws()] } });
  return { orgA, orgB, project, M };
}
async function login(email, password) {
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email, password }).expect(200);
  return agent;
}

test('API: idempotency, tenant isolation, approvals', async (t) => {
  if (skip) return t.skip(skip);
  const { orgA, project, M } = await seed();
  const op = await login('op@a.test', 'password-op');
  const body = { projectId: String(project._id), instruction: 'Add health endpoint', agents: [{ slug: 'backend-engineer' }], idempotencyKey: 'key-12345678' };

  await op.post(`/api/v1/orgs/${orgA._id}/tasks`).send(body).expect(403); // CSRF header missing
  const first = await op.post(`/api/v1/orgs/${orgA._id}/tasks`).set(H).send(body).expect(201);
  const second = await op.post(`/api/v1/orgs/${orgA._id}/tasks`).set(H).send(body).expect(200);
  assert.equal(first.body.task._id, second.body.task._id);
  assert.equal(enqueued.length, 1);

  const [clientOne, clientTwo] = await M.Client.create([
    { organizationId: orgA._id, name: 'Visible Client' },
    { organizationId: orgA._id, name: 'Hidden Client' },
  ]);
  const [visibleProject, hiddenProject] = await M.Project.create([
    { organizationId: orgA._id, clientId: clientOne._id, name: 'Visible Project', workspace: { allowedRoots: [ws()] } },
    { organizationId: orgA._id, clientId: clientTwo._id, name: 'Hidden Project', workspace: { allowedRoots: [ws()] } },
  ]);
  await M.Project.create({ organizationId: orgA._id, clientId: clientOne._id, name: 'Out of scope client project', workspace: { allowedRoots: [ws()] } });
  const ownerUser = await M.User.findOne({ email: 'op@a.test' });
  const [visibleTask, hiddenTask] = await M.Task.create([
    { organizationId: orgA._id, projectId: visibleProject._id, createdBy: ownerUser._id, idempotencyKey: 'visible-task-0001', instruction: 'visible task', status: 'RUNNING' },
    { organizationId: orgA._id, projectId: hiddenProject._id, createdBy: ownerUser._id, idempotencyKey: 'hidden-task-0001', instruction: 'hidden task' },
  ]);
  await M.UsageRecord.create([
    { organizationId: orgA._id, taskId: visibleTask._id, usage: { inputTokens: 10, outputTokens: 2, costUsd: 0.01 } },
    { organizationId: orgA._id, taskId: hiddenTask._id, usage: { inputTokens: 900, outputTokens: 200, costUsd: 9 } },
  ]);
  const [visibleRun, hiddenRun] = await M.AgentRun.create([
    { organizationId: orgA._id, taskId: visibleTask._id, agentSlug: 'backend-engineer', status: 'RUNNING', startedAt: new Date() },
    { organizationId: orgA._id, taskId: hiddenTask._id, agentSlug: 'seo-specialist', status: 'RUNNING', startedAt: new Date() },
  ]);
  await M.TaskEvent.create([
    { organizationId: orgA._id, taskId: visibleTask._id, agentRunId: visibleRun._id, seq: 1, kind: 'agent_message', data: { text: 'Working on the authorized visible project.' } },
    { organizationId: orgA._id, taskId: hiddenTask._id, agentRunId: hiddenRun._id, seq: 1, kind: 'agent_message', data: { text: 'Hidden project output.' } },
  ]);
  const { hashPassword } = await import('../../src/core/session.js');
  const scopedUser = await M.User.create({ email: 'scoped@a.test', passwordHash: hashPassword('password-scoped') });
  await M.Membership.create({ organizationId: orgA._id, userId: scopedUser._id, role: 'PROJECT_MANAGER', projectIds: [visibleProject._id] });
  const clientManager = await M.User.create({ email: 'client-manager@a.test', passwordHash: hashPassword('password-client-manager') });
  await M.Membership.create({ organizationId: orgA._id, userId: clientManager._id, role: 'PROJECT_MANAGER' });
  const scoped = await login('scoped@a.test', 'password-scoped');
  const visibleClients = await scoped.get(`/api/v1/orgs/${orgA._id}/clients`).expect(200);
  assert.deepEqual(visibleClients.body.map((c) => c._id), [String(clientOne._id)]);
  assert.deepEqual(visibleClients.body[0].projects.map((p) => p._id), [String(visibleProject._id)]);
  const clientWorkspace = await scoped.get(`/api/v1/orgs/${orgA._id}/clients/${clientOne._id}`).expect(200);
  assert.deepEqual(clientWorkspace.body.projects.map((p) => p._id), [String(visibleProject._id)]);
  assert.deepEqual(clientWorkspace.body.tasks.map((t) => t.instruction), ['visible task']);
  const projectWorkspace = await scoped.get(`/api/v1/orgs/${orgA._id}/projects/${visibleProject._id}`).expect(200);
  assert.equal(projectWorkspace.body.client._id, String(clientOne._id));
  assert.deepEqual(projectWorkspace.body.project.workspace.allowedRoots, visibleProject.workspace.allowedRoots.toObject());
  assert.deepEqual(projectWorkspace.body.tasks.map((t) => t.instruction), ['visible task']);
  await scoped.get(`/api/v1/orgs/${orgA._id}/projects/${hiddenProject._id}`).expect(403);
  await scoped.get(`/api/v1/orgs/${orgA._id}/clients/${clientTwo._id}`).expect(404);
  const overview = await scoped.get(`/api/v1/orgs/${orgA._id}/overview`).expect(200);
  assert.equal(overview.body.clients, 1);
  assert.equal(overview.body.projects, 1);
  assert.equal(overview.body.tasks, 1);
  assert.equal(overview.body.tasksByStatus.RUNNING, 1);
  assert.equal(overview.body.database.status, 'CONNECTED');
  assert.deepEqual(overview.body.activeAgents.map((run) => run.agentSlug), ['backend-engineer']);
  assert.equal(overview.body.connector.status, 'NOT_CONFIGURED');
  const scopedUsage = await scoped.get(`/api/v1/orgs/${orgA._id}/usage`).expect(200);
  assert.equal(scopedUsage.body.inputTokens, 10);
  assert.equal(scopedUsage.body.costUsd, 0.01);
  const sessions = await scoped.get(`/api/v1/orgs/${orgA._id}/sessions`).expect(200);
  assert.equal(sessions.body.length, 1);
  assert.equal(sessions.body[0].agentSlug, 'backend-engineer');
  assert.equal(sessions.body[0].events[0].details, 'Working on the authorized visible project.');

  const readOnlyUser = await M.User.create({ email: 'reader@a.test', passwordHash: hashPassword('password-reader') });
  await M.Membership.create({ organizationId: orgA._id, userId: readOnlyUser._id, role: 'VIEWER', projectIds: [visibleProject._id] });
  const reader = await login('reader@a.test', 'password-reader');
  const restrictedWorkspace = await reader.get(`/api/v1/orgs/${orgA._id}/projects/${visibleProject._id}`).expect(200);
  assert.equal(restrictedWorkspace.body.project.workspace.configured, true);
  assert.equal('allowedRoots' in restrictedWorkspace.body.project.workspace, false);

  const clientSkill = await M.Skill.create({ organizationId: orgA._id, slug: 'client-brand-voice', enabled: true, activeVersion: 1 });
  await M.SkillVersion.create({ skillId: clientSkill._id, version: 1, status: 'APPROVED', content: 'Use the approved client voice. Do not alter tool permissions.', hash: 'client-brand-hash-v1' });
  await scoped.put(`/api/v1/orgs/${orgA._id}/clients/${clientOne._id}/skills`).set(H).send({ skillSlugs: ['client-brand-voice'] }).expect(403);
  const clientAdmin = await login('client-manager@a.test', 'password-client-manager');
  const assignedClientSkills = await clientAdmin.put(`/api/v1/orgs/${orgA._id}/clients/${clientOne._id}/skills`).set(H).send({ skillSlugs: ['client-brand-voice'] }).expect(200);
   assert.deepEqual(assignedClientSkills.body.versions, [{ slug: 'client-brand-voice', version: 1, hash: 'client-brand-hash-v1' }]);
   const projectSkill = await M.Skill.create({ organizationId: orgA._id, slug: 'project-delivery-guide', enabled: true, activeVersion: 1 });
   await M.SkillVersion.create({ skillId: projectSkill._id, version: 1, status: 'APPROVED', content: 'Follow project delivery guidance.', hash: 'project-delivery-v1' });
   await scoped.put(`/api/v1/orgs/${orgA._id}/projects/${visibleProject._id}/skills`).set(H).send({ skillSlugs: ['project-delivery-guide'] }).expect(200);
  const draftSkill = await M.Skill.create({ organizationId: orgA._id, slug: 'draft-only-skill', enabled: true, activeVersion: 1 });
  await M.SkillVersion.create({ skillId: draftSkill._id, version: 1, status: 'DRAFT', content: 'Not approved.', hash: 'draft-only-v1' });
  await clientAdmin.put(`/api/v1/orgs/${orgA._id}/clients/${clientOne._id}/skills`).set(H).send({ skillSlugs: ['draft-only-skill'] }).expect(409);
  const skillTask = await scoped.post(`/api/v1/orgs/${orgA._id}/tasks`).set(H).send({
    projectId: String(visibleProject._id), instruction: 'Draft a client page', mode: 'QUICK',
    agents: [{ slug: 'backend-engineer' }], idempotencyKey: 'client-skill-task-0001',
  }).expect(201);
   assert.deepEqual(skillTask.body.task.projectSkills.map(({ slug, version, hash }) => ({ slug, version, hash })), [
     { slug: 'client-brand-voice', version: 1, hash: 'client-brand-hash-v1' },
     { slug: 'project-delivery-guide', version: 1, hash: 'project-delivery-v1' },
   ]);

  const taskCount = await M.Task.countDocuments({ organizationId: orgA._id });
  const clarify = await op.post(`/api/v1/orgs/${orgA._id}/ceo/execute`).set(H).send({
    request: 'xyzzy frobnicate the plover', projectId: String(project._id),
    idempotencyKey: 'ceo-clarify-123456', execute: true,
  }).expect(200);
  assert.equal(clarify.body.requiresClarification, true);
  assert.equal(clarify.body.dryRun, true);
  assert.equal(await M.Task.countDocuments({ organizationId: orgA._id }), taskCount);

  const b = await login('b@b.test', 'password-b');
  await b.get(`/api/v1/orgs/${orgA._id}/tasks`).expect(403);
  await b.get(`/api/v1/orgs/${orgA._id}/tasks/${first.body.task._id}`).expect(403);

  const { requestApproval } = await import('../../src/services/approvals.js');
  const opUser = await M.User.findOne({ email: 'op@a.test' });
  const appr = await requestApproval({ organizationId: orgA._id, taskId: first.body.task._id, action: 'deploy.production', target: 'web', payload: { sha: '1' }, requestedBy: String(opUser._id) });
  await op.post(`/api/v1/orgs/${orgA._id}/approvals/${appr._id}/decision`).set(H).send({ decision: 'APPROVED' }).expect(403); // operator lacks permission
  const rev = await login('rev@a.test', 'password-rev');
  const ok = await rev.post(`/api/v1/orgs/${orgA._id}/approvals/${appr._id}/decision`).set(H).send({ decision: 'APPROVED' }).expect(200);
  assert.equal(ok.body.status, 'APPROVED');

  const events = await op.get(`/api/v1/orgs/${orgA._id}/tasks/${first.body.task._id}/events?since=0`).expect(200);
  assert.ok(events.body.length >= 2);
  assert.deepEqual(events.body.map((e) => e.seq), [...events.body.map((e) => e.seq)].sort((x, y) => x - y));

  const { authorizeSubscription } = await import('../../src/ws/gateway.js');
  const bUser = await M.User.findOne({ email: 'b@b.test' });
  assert.equal((await authorizeSubscription(bUser._id, first.body.task._id)).allowed, false);
  assert.equal((await authorizeSubscription(opUser._id, first.body.task._id)).allowed, true);
});

test('orchestrator: plan, real-usage recording, acceptance gate', async (t) => {
  if (skip) return t.skip(skip);
  const M = await import('../../src/models/index.js');
  const { createTask } = await import('../../src/services/tasks.js');
  const { executeTask } = await import('../../src/services/orchestrator.js');
  const { resolveProjectSkillRefs } = await import('../../src/services/projectSkills.js');
  const { EventEmitter } = await import('node:events');
  const org = await M.Organization.create({ name: 'O', slug: 'org-orch' });
  const user = await M.User.create({ email: 'orch@o.test' });
  const project = await M.Project.create({ organizationId: org._id, name: 'P', skillSlugs: ['approved-project-guide'], workspace: { allowedRoots: [ws()] } });
  for (const [slug, watches, produces] of [['product-manager', ['UserRequirement'], ['PRD']], ['backend-engineer', ['PRD'], ['Code']]]) {
    const a = await M.Agent.create({ slug, name: slug, department: 'Eng', publishedVersion: 1 });
    await M.AgentVersion.create({ agentId: a._id, version: 1, status: 'PUBLISHED', watches, produces, allowedTools: ['Read'] });
  }
  const skill = await M.Skill.create({ organizationId: org._id, slug: 'approved-project-guide', enabled: true, activeVersion: 1 });
  await M.SkillVersion.create({ skillId: skill._id, version: 1, status: 'APPROVED', content: 'Follow this approved project guidance.', allowedTools: ['Bash'], hash: 'approved-project-guide-v1' });
  const projectSkills = await resolveProjectSkillRefs(org._id, project.skillSlugs);
  const management = { departmentHeads: [{ slug: 'cto', departmentSlug: 'software-engineering' }], projectManager: { slug: 'project-manager', departmentSlug: 'product-delivery' } };
  const { task } = await createTask({ organizationId: org._id, projectId: project._id, createdBy: user._id, idempotencyKey: 'orch-0001', instruction: 'x', agents: [{ slug: 'backend-engineer' }, { slug: 'product-manager' }], management, projectSkills });
  let runnerOptions;
  const runner = (options) => { runnerOptions = options; return { events: new EventEmitter(), done: Promise.resolve({ ok: true, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.002, turns: 1 }, sessionId: 's', final: { summary: 'done' } }) }; };
  const final = await executeTask({ organizationId: org._id, taskId: task._id, runner });
  assert.deepEqual(JSON.parse(JSON.stringify(final.plan.stages)), [['product-manager'], ['backend-engineer']]);
  assert.equal(final.status, 'AWAITING_APPROVAL'); // AC-2 needs a validator or human acceptance
  assert.equal(final.acceptanceCriteria[0].status, 'PASSED');
  assert.equal(final.acceptanceCriteria[1].status, 'PENDING');
  assert.deepEqual(final.management.departmentHeads.map(({ slug, departmentSlug }) => ({ slug, departmentSlug })), management.departmentHeads);
  assert.deepEqual({ slug: final.management.projectManager.slug, departmentSlug: final.management.projectManager.departmentSlug }, management.projectManager);
  assert.deepEqual(final.projectSkills.map(({ slug, version, hash }) => ({ slug, version, hash })), projectSkills);
  assert.match(runnerOptions.appendSystemPrompt, /Follow this approved project guidance/);
  assert.deepEqual(runnerOptions.allowedTools, ['Read']);
  assert.equal(final.usage.inputTokens, 200);
  assert.equal(await M.UsageRecord.countDocuments({ taskId: task._id }), 2);
});

test('governance: client-required isolated projects, preflight, cancel/stall/retry, audit, catalog', async (t) => {
  if (skip) return t.skip(skip);
  const M = await import('../../src/models/index.js');
  const { hashPassword } = await import('../../src/core/session.js');
  const { sweepStalls } = await import('../../src/services/stalls.js');
  const org = await M.Organization.create({ name: 'Gov', slug: 'org-gov' });
  const admin = await M.User.create({ email: 'admin@gov.test', name: 'Gov Admin', passwordHash: hashPassword('password-admin') });
  await M.Membership.create({ organizationId: org._id, userId: admin._id, role: 'ORG_ADMIN' });
  await M.Department.create({ slug: 'software-engineering', name: 'Software Engineering', head: { slug: 'cto', title: 'CTO' } });
  await M.Agent.updateOne({ organizationId: null, slug: 'backend-engineer' }, { $set: { name: 'Backend Engineer', department: 'Software Engineering', kind: 'CORE_ROLE', departmentSlug: 'software-engineering' } }, { upsert: true });
  await M.Agent.create({ slug: 'old-legacy-agent', name: 'Old Legacy Agent', department: 'Misc' });
  await workerOffline();
  const anon = request.agent(app);
  assert.deepEqual((await anon.get('/api/v1/auth/session').expect(200)).body, { authenticated: false, expiresAt: null });
  const a = await login('admin@gov.test', 'password-admin');
  assert.equal((await a.get('/api/v1/auth/session').expect(200)).body.authenticated, true);
  const api = `/api/v1/orgs/${org._id}`;
  const client = (await a.post(`${api}/clients`).set(H).send({ name: 'Acme' }).expect(201)).body;
  const rootA = ws();

  // W-05: a project needs a client.
  await a.post(`${api}/projects`).set(H).send({ name: 'No client', allowedRoots: [ws()] }).expect(400);
  const pA = (await a.post(`${api}/projects`).set(H).send({ name: 'Shop', clientId: client._id, allowedRoots: [rootA] }).expect(201)).body;
  // W-01: no shared, nested or app-tree roots.
  const dup = await a.post(`${api}/projects`).set(H).send({ name: 'Shop copy', clientId: client._id, allowedRoots: [rootA] }).expect(409);
  assert.match(dup.body.error, /already used by "Shop"/);
  await a.post(`${api}/projects`).set(H).send({ name: 'Shop admin', clientId: client._id, allowedRoots: [path.join(rootA, 'admin')] }).expect(409);
  const appTree = await a.post(`${api}/projects`).set(H).send({ name: 'Inside app', clientId: client._id, allowedRoots: [path.resolve(process.cwd(), 'tmp-inside')] }).expect(422);
  assert.match(appTree.body.error, /DATYLUNE application/);
  await a.post(`${api}/projects`).set(H).send({ name: 'Traversal', clientId: client._id, allowedRoots: [`${rootA}${path.sep}..${path.sep}x`] }).expect(422);
  const pEmpty = (await a.post(`${api}/projects`).set(H).send({ name: 'Unconfigured', clientId: client._id }).expect(201)).body;
  const moved = ws();
  const patched = await a.patch(`${api}/projects/${pEmpty._id}`).set(H).send({ allowedRoots: [rootA] }).expect(409);
  assert.match(patched.body.error, /already used/);
  // Opting out of folder creation requires the folder to exist already.
  await a.patch(`${api}/projects/${pEmpty._id}`).set(H).send({ allowedRoots: [path.join(ws(), 'missing')], createFolder: false }).expect(422);

  // W-07: preflight blocks unsafe dispatch.
  const pfEmpty = (await a.get(`${api}/projects/${pEmpty._id}/preflight`).expect(200)).body;
  assert.equal(pfEmpty.ok, false);
  assert.equal(pfEmpty.checks.find((c) => c.id === 'workspace').status, 'fail');
  const blocked = await a.post(`${api}/tasks`).set(H).send({ projectId: pEmpty._id, instruction: 'do work', agents: [{ slug: 'backend-engineer' }], idempotencyKey: 'gov-blocked-0001' }).expect(409);
  assert.equal(blocked.body.code, 'PREFLIGHT_FAILED');
  const ceoBlocked = await a.post(`${api}/ceo/execute`).set(H).send({ request: 'build a login api endpoint', projectId: pEmpty._id, idempotencyKey: 'gov-ceo-blocked-01', execute: true }).expect(409);
  assert.equal(ceoBlocked.body.code, 'PREFLIGHT_FAILED');
  await a.patch(`${api}/projects/${pEmpty._id}`).set(H).send({ allowedRoots: [moved] }).expect(200);
  // Phase 0: no worker online blocks every entry point unless a human confirms "Queue anyway".
  const pfA = (await a.get(`${api}/projects/${pA._id}/preflight`).expect(200)).body;
  assert.equal(pfA.ok, false);
  assert.equal(pfA.code, 'WORKER_OFFLINE');
  assert.equal(pfA.checks.find((c) => c.id === 'worker').status, 'fail');
  assert.equal(pfA.checks.find((c) => c.id === 'worker').overridable, true);
  const offTask = await a.post(`${api}/tasks`).set(H).send({ projectId: pA._id, instruction: 'do work', agents: [{ slug: 'backend-engineer' }], idempotencyKey: 'gov-offline-0001' }).expect(409);
  assert.equal(offTask.body.code, 'WORKER_OFFLINE');
  const offCeo = await a.post(`${api}/ceo/execute`).set(H).send({ request: 'build a login api endpoint', projectId: pA._id, idempotencyKey: 'gov-offline-0002', execute: true }).expect(409);
  assert.equal(offCeo.body.code, 'WORKER_OFFLINE');
  const offChat = await a.post(`${api}/agents/backend-engineer/chat`).set(H).send({ message: 'hello', projectId: pA._id }).expect(409);
  assert.equal(offChat.body.code, 'WORKER_OFFLINE');
  // A workspace problem is never overridable.
  const noFolder = await M.Project.create({ organizationId: org._id, clientId: client._id, name: 'No folder' });
  const notOverridable = await a.post(`${api}/tasks`).set(H).send({ projectId: String(noFolder._id), instruction: 'do work', agents: [{ slug: 'backend-engineer' }], idempotencyKey: 'gov-offline-0003', queueAnyway: true }).expect(409);
  assert.equal(notOverridable.body.code, 'PREFLIGHT_FAILED');
  await M.Project.deleteOne({ _id: noFolder._id });
  await a.post(`${api}/agents/backend-engineer/chat`).set(H).send({ message: 'hello', projectId: pA._id, queueAnyway: true }).expect(201);
  const pfAnyway = (await a.get(`${api}/projects/${pA._id}/preflight`).expect(200)).body;
  assert.ok(pfAnyway.checks.every((c) => c.id === 'worker' || c.status !== 'fail'));

  // W-06: executing never creates a project.
  const projectsBefore = await M.Project.countDocuments({ organizationId: org._id });
  const exec = await a.post(`${api}/ceo/execute`).set(H).send({ request: 'build a login api endpoint', projectId: pA._id, idempotencyKey: 'gov-ceo-exec-0001', execute: true, queueAnyway: true }).expect(201);
  const execAudit = await M.AuditLog.findOne({ organizationId: org._id, action: 'ceo.execute', target: exec.body.task._id }).lean();
  assert.equal(execAudit.details.queuedWithoutWorker, true);
  assert.equal(await M.Project.countDocuments({ organizationId: org._id }), projectsBefore);
  assert.equal(String(exec.body.task.projectId), pA._id);
  assert.ok(exec.body.task.acceptanceCriteria.some((c) => c.role === 'backend-engineer'));

  // W-02: cancel closes runs and approvals together, and is audited.
  const task = (await a.post(`${api}/tasks`).set(H).send({ projectId: pA._id, instruction: 'Add an endpoint', agents: [{ slug: 'backend-engineer' }], idempotencyKey: 'gov-task-00001', queueAnyway: true }).expect(201)).body.task;
  await M.Task.updateOne({ _id: task._id }, { status: 'RUNNING' });
  await M.AgentRun.create({ organizationId: org._id, taskId: task._id, agentSlug: 'backend-engineer', status: 'RUNNING', startedAt: new Date(), summary: `Wrote ${path.join(rootA, 'server.js')}` });
  const { requestApproval } = await import('../../src/services/approvals.js');
  const appr = await requestApproval({ organizationId: org._id, taskId: task._id, action: 'deploy.production', target: 'web', payload: { v: 1 }, requestedBy: String(admin._id) });
  const detail = (await a.get(`${api}/tasks/${task._id}`).expect(200)).body;
  assert.match(detail.runs[0].summary, /<workspace>[\\/]server\.js/, 'W-11: absolute workspace path redacted');
  assert.equal(detail.client.name, 'Acme');
  const cancelled = (await a.post(`${api}/tasks/${task._id}/cancel`).set(H).expect(200)).body;
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal((await M.AgentRun.findOne({ taskId: task._id })).status, 'CANCELLED');
  assert.equal((await M.Approval.findById(appr._id)).status, 'INVALIDATED');
  const sessions = (await a.get(`${api}/sessions`).expect(200)).body.filter((s) => s.taskId === task._id);
  assert.deepEqual(sessions.map((s) => [s.status, s.taskStatus]), [['CANCELLED', 'CANCELLED']]);
  assert.equal(await M.AuditLog.countDocuments({ organizationId: org._id, action: 'task.cancel', target: task._id }), 1);

  // W-03: a task left in QUEUED with no worker becomes STALLED; retry re-queues once.
  enqueued.length = 0;
  const waiting = (await a.post(`${api}/tasks`).set(H).send({ projectId: pA._id, instruction: 'CREAT POTFLIO', agents: [{ slug: 'backend-engineer' }], idempotencyKey: 'gov-task-00002', queueAnyway: true }).expect(201)).body.task;
  await M.Task.collection.updateOne({ _id: new mongoose.Types.ObjectId(waiting._id) }, { $set: { updatedAt: new Date(Date.now() - 2 * 3600_000) } });
  const sweep = await sweepStalls();
  assert.ok(sweep.marked >= 1);
  assert.equal(sweep.worker.status, 'NEVER_SEEN');
  const stalled = await M.Task.findById(waiting._id);
  assert.equal(stalled.status, 'STALLED');
  assert.match(stalled.stall.reason, /no execution worker is online/);
  const overview = (await a.get(`${api}/overview`).expect(200)).body;
  assert.ok(overview.alerts.some((x) => x.id === 'worker') && overview.alerts.some((x) => x.id === 'stalled'));
  assert.equal(overview.tasksByStatus.STALLED, 1);
  assert.equal((await a.post(`${api}/tasks/${waiting._id}/retry`).set(H).expect(409)).body.code, 'WORKER_OFFLINE');
  const retried = (await a.post(`${api}/tasks/${waiting._id}/retry`).set(H).send({ queueAnyway: true }).expect(200)).body;
  assert.equal(retried.status, 'QUEUED');
  assert.equal(enqueued.filter((j) => String(j.taskId) === waiting._id).length, 2, 'once on create, once on retry');
  const again = await a.post(`${api}/tasks/${waiting._id}/retry`).set(H).send({ queueAnyway: true }).expect(409);
  assert.equal(again.body.code, 'INVALID_TRANSITION');

  // W-12: audit is filterable and names actors and targets.
  const auditPage = (await a.get(`${api}/audit?action=task.`).expect(200)).body;
  assert.ok(auditPage.items.length >= 4 && auditPage.items.every((e) => e.action.startsWith('task.')));
  assert.ok(auditPage.items.some((e) => e.action === 'task.stalled' && e.actor.kind === 'system'));
  assert.ok(auditPage.items.some((e) => e.actorName === 'Gov Admin' && e.targetLabel?.type === 'task'));

  // W-04 / W-25: canonical catalogue by default; legacy only on request; detail view.
  const agents = (await a.get(`${api}/agents`).expect(200)).body;
  assert.ok(agents.every((x) => !x.legacy) && !agents.some((x) => x.slug === 'old-legacy-agent'));
  const withLegacy = (await a.get(`${api}/agents?include=legacy`).expect(200)).body;
  assert.equal(withLegacy.find((x) => x.slug === 'old-legacy-agent').legacy, true);
  const agentDetail = (await a.get(`${api}/agents/backend-engineer`).expect(200)).body;
  assert.equal(agentDetail.runs.total, 1);
  // Phase 0: no API response carries an absolute path (audit details included).
  await a.patch(`${api}/projects/${pA._id}`).set(H).send({ name: 'Shop renamed' }).expect(200);
  for (const url of [`${api}/tasks/${task._id}`, `${api}/tasks`, `${api}/sessions`, `${api}/audit`, `${api}/overview`, `${api}/monitoring`, `${api}/projects/${pA._id}/preflight`, `${api}/projects`, `${api}/clients`]) {
    const body = (await a.get(url).expect(200)).body;
    assert.equal(leaks(body), false, `absolute path leaked by ${url}`);
  }
  const projectsForAdmin = (await a.get(`${api}/projects`).expect(200)).body;
  assert.equal(projectsForAdmin.find((p) => p._id === pA._id).workspace.allowedRoots[0], rootA, 'admins keep the full root on project settings');
  await workerOnline();
  const me = (await a.get('/api/v1/me').expect(200)).body;
  assert.ok(new Date(me.sessionExpiresAt) > new Date());
});

test('orchestrator: cancellation mid-run never records a COMPLETED run; worker errors fail the task', async (t) => {
  if (skip) return t.skip(skip);
  const M = await import('../../src/models/index.js');
  const { createTask, cancelTask } = await import('../../src/services/tasks.js');
  const { executeTask } = await import('../../src/services/orchestrator.js');
  const { processTask } = await import('../../src/queue/worker.js');
  const { EventEmitter } = await import('node:events');
  const org = await M.Organization.create({ name: 'C', slug: 'org-cancel' });
  const user = await M.User.create({ email: 'c@c.test' });
  const project = await M.Project.create({ organizationId: org._id, name: 'P', workspace: { allowedRoots: [ws()] } });
  const a = await M.Agent.create({ slug: 'cancel-agent', name: 'Cancel Agent', department: 'Eng', publishedVersion: 1 });
  await M.AgentVersion.create({ agentId: a._id, version: 1, status: 'PUBLISHED', allowedTools: ['Read'] });

  const { task } = await createTask({ organizationId: org._id, projectId: project._id, createdBy: user._id, idempotencyKey: 'cancel-0001', instruction: 'x', agents: [{ slug: 'cancel-agent' }] });
  const ac = new AbortController();
  const runner = () => ({ events: new EventEmitter(), done: (async () => {
    await cancelTask({ organizationId: org._id, taskId: task._id }); // user clicks Cancel in the API process
    ac.abort(); // worker's cancellation watcher fires
    return { ok: true, usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, sessionId: 's', final: { summary: 'finished anyway' } };
  })() });
  const final = await executeTask({ organizationId: org._id, taskId: task._id, signal: ac.signal, runner });
  assert.equal(final.status, 'CANCELLED');
  assert.deepEqual((await M.AgentRun.find({ taskId: task._id })).map((r) => r.status), ['CANCELLED']);

  const { task: broken } = await createTask({ organizationId: org._id, projectId: project._id, createdBy: user._id, idempotencyKey: 'cancel-0002', instruction: 'x', agents: [{ slug: 'missing-agent' }] });
  assert.equal(await processTask({ organizationId: String(org._id), taskId: String(broken._id) }), 'FAILED');
  const failed = await M.Task.findById(broken._id);
  assert.equal(failed.status, 'FAILED', 'an orchestrator exception no longer strands the task in PLANNING');
  assert.match(failed.error, /agent not available: missing-agent/);
});
