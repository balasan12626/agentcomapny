// Requires MongoDB: set MONGODB_TEST_URI, or have mongodb-memory-server able
// to download a binary. Skips (does NOT pass) otherwise.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';

process.env.SESSION_SECRET = 'test-secret-'.padEnd(40, 'x');
process.env.NODE_ENV = 'test';

let mem;
let skip = false;
let app;
const enqueued = [];
const H = { 'x-datylune-csrf': '1' };

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
  const project = await M.Project.create({ organizationId: orgA._id, name: 'P', workspace: { allowedRoots: ['/tmp'] } });
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
  const { EventEmitter } = await import('node:events');
  const org = await M.Organization.create({ name: 'O', slug: 'org-orch' });
  const user = await M.User.create({ email: 'orch@o.test' });
  const project = await M.Project.create({ organizationId: org._id, name: 'P', workspace: { allowedRoots: [process.cwd()] } });
  for (const [slug, watches, produces] of [['product-manager', ['UserRequirement'], ['PRD']], ['backend-engineer', ['PRD'], ['Code']]]) {
    const a = await M.Agent.create({ slug, name: slug, department: 'Eng', publishedVersion: 1 });
    await M.AgentVersion.create({ agentId: a._id, version: 1, status: 'PUBLISHED', watches, produces, allowedTools: ['Read'] });
  }
  const { task } = await createTask({ organizationId: org._id, projectId: project._id, createdBy: user._id, idempotencyKey: 'orch-0001', instruction: 'x', agents: [{ slug: 'backend-engineer' }, { slug: 'product-manager' }] });
  const runner = () => ({ events: new EventEmitter(), done: Promise.resolve({ ok: true, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.002, turns: 1 }, sessionId: 's', final: { summary: 'done' } }) });
  const final = await executeTask({ organizationId: org._id, taskId: task._id, runner });
  assert.deepEqual(JSON.parse(JSON.stringify(final.plan.stages)), [['product-manager'], ['backend-engineer']]);
  assert.equal(final.status, 'AWAITING_APPROVAL'); // AC-2 needs a validator or human acceptance
  assert.equal(final.usage.inputTokens, 200);
  assert.equal(await M.UsageRecord.countDocuments({ taskId: task._id }), 2);
});
