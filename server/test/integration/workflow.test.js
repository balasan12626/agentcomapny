// Phases 1–2 (docs/PHASES.md): workflow models, migration and the
// state-machine service against a real MongoDB. Agents are simulated here by
// agent actors; real agent execution is Phase 3.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

process.env.SESSION_SECRET = 'test-secret-'.padEnd(40, 'x');
process.env.NODE_ENV = 'test';

let mem;
let skip = false;
let M;
let W;

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
  // Separate database from api.test.js so the files can run in any order.
  await mongoose.connect(uri.replace(/\/([^/?]*)(\?|$)/, (m, db, q) => `/${db || 'test'}_workflow${q}`));
  await mongoose.connection.db.dropDatabase();
  M = await import('../../src/models/index.js');
  W = await import('../../src/services/workflow.js');
  await Promise.all(Object.values(M).filter((x) => x?.createIndexes).map((x) => x.createIndexes()));
});
after(async () => {
  if (mongoose.connection.readyState) { await mongoose.connection.db.dropDatabase(); await mongoose.disconnect(); }
  await mem?.stop();
});

const workerOnline = () => M.WorkerHeartbeat.updateOne({ workerId: 'wf-worker' }, { $set: { lastSeenAt: new Date(Date.now() + 3600_000), concurrency: 2, activeJobs: 0 } }, { upsert: true });
const workerOffline = () => M.WorkerHeartbeat.deleteMany({});

async function world(slug) {
  const org = await M.Organization.create({ name: slug, slug });
  const ceo = await M.User.create({ email: `ceo@${slug}.test` });
  const pmUser = await M.User.create({ email: `pm@${slug}.test` });
  const op = await M.User.create({ email: `op@${slug}.test` });
  const [mCeo, mPm, mOp] = await M.Membership.create([
    { organizationId: org._id, userId: ceo._id, role: 'ORG_ADMIN' },
    { organizationId: org._id, userId: pmUser._id, role: 'PROJECT_MANAGER' },
    { organizationId: org._id, userId: op._id, role: 'AGENT_OPERATOR' },
  ]);
  const client = await M.Client.create({ organizationId: org._id, name: `${slug} client` });
  const project = await M.Project.create({ organizationId: org._id, clientId: client._id, name: `${slug} site`, workspace: { allowedRoots: [`C:\\ws\\${slug}`] } });
  const o = String(org._id);
  const A = {
    ceo: W.userActor(ceo, mCeo), pm: W.userActor(pmUser, mPm), op: W.userActor(op, mOp), system: W.systemActor(o),
    ba: W.agentActor({ organizationId: o, slug: 'business-analyst', workflowRole: 'BA' }),
    pmAgent: W.agentActor({ organizationId: o, slug: 'project-manager', workflowRole: 'PM' }),
    cto: W.agentActor({ organizationId: o, slug: 'cto', workflowRole: 'HEAD', departmentSlug: 'software-engineering' }),
    fe: W.agentActor({ organizationId: o, slug: 'frontend-engineer', workflowRole: 'SPECIALIST', departmentSlug: 'software-engineering' }),
    be: W.agentActor({ organizationId: o, slug: 'backend-engineer', workflowRole: 'SPECIALIST', departmentSlug: 'software-engineering' }),
    qa: W.agentActor({ organizationId: o, slug: 'qa-engineer', workflowRole: 'QA' }),
    client: W.agentActor({ organizationId: o, slug: 'client-agent', workflowRole: 'CLIENT', clientId: client._id }),
    ceoAgent: W.agentActor({ organizationId: o, slug: 'founder-ceo', workflowRole: 'CEO_AGENT' }),
  };
  return { org, o, client, project, A };
}

const SPEC = {
  summary: 'One-page portfolio for a freelance designer',
  businessGoal: 'Win more client enquiries',
  targetUsers: ['prospective clients'],
  scope: { inScope: ['home page', 'project gallery', 'contact form'], outOfScope: ['blog', 'CMS'] },
  features: [{ id: 'F-1', title: 'Gallery', description: 'Grid of 6 projects', priority: 'MUST' }, { id: 'F-2', title: 'Contact', description: 'Form posts to mailto', priority: 'SHOULD' }],
  acceptanceCriteria: [
    { id: 'AC-1', featureId: 'F-1', criterion: 'index.html shows 6 project cards with alt text', testMethod: 'DOM test counts .card img[alt]' },
    { id: 'AC-2', featureId: 'F-2', criterion: 'Contact form validates email before submit', testMethod: 'unit test of validateEmail()' },
  ],
  clarifyingQuestions: [],
  risks: ['Image licensing'],
  assumptions: ['Static hosting'],
  estimate: { effortHours: 6, costUSD: 3, durationDays: 2, departmentsNeeded: ['software-engineering'] },
  baRecommendation: 'ACCEPT',
  baReason: 'Scope is clear and small',
};
const evidence = [{ type: 'test-output', content: 'node --test: 4 passing, 0 failing' }];
const qaPass = (ids) => ({ verdict: 'PASS', criteriaResults: ids.map((id) => ({ criterionId: id, pass: true, evidence: `${id}: automated check passed — node --test 4/4` })) });

async function seedCatalog() {
  await M.Department.updateOne({ slug: 'software-engineering', organizationId: null }, { $set: { name: 'Software Engineering', head: { slug: 'cto', title: 'CTO' } } }, { upsert: true });
  for (const slug of ['frontend-engineer', 'backend-engineer']) {
    await M.Agent.updateOne({ organizationId: null, slug }, { $set: { name: slug, department: 'Software Engineering', kind: 'CORE_ROLE', departmentSlug: 'software-engineering' } }, { upsert: true });
  }
  await M.Agent.updateOne({ organizationId: null, slug: 'seo-specialist' }, { $set: { name: 'SEO', department: 'Marketing', kind: 'CORE_ROLE', departmentSlug: 'marketing' } }, { upsert: true });
}

// Request → analysed spec → AWAITING_CEO.
async function toCeo(w, spec = SPEC) {
  const req = await W.createRequest({ organizationId: w.o, actor: w.A.op, clientId: w.client._id, projectId: w.project._id, title: 'Portfolio website', description: 'Need a portfolio site to show my design work.' });
  await W.move('request', { organizationId: w.o, id: req._id, to: 'IN_ANALYSIS', actor: w.A.op });
  await W.saveSpec({ organizationId: w.o, requestId: req._id, actor: w.A.ba, spec });
  return W.concludeAnalysis({ organizationId: w.o, requestId: req._id, actor: w.A.ba });
}

test('Phase 1: models are tenant- and client-scoped; versions are unique', async (t) => {
  if (skip) return t.skip(skip);
  await assert.rejects(M.ClientRequest.create({ title: 'x', description: 'y' }), /organizationId.*required|clientId.*required|validation failed/i);
  const w = await world('p1');
  const req = await W.createRequest({ organizationId: w.o, actor: w.A.op, clientId: w.client._id, title: 'T', description: 'D' });
  assert.equal(req.status, 'NEW');
  assert.equal(req.history.length, 1);
  assert.equal(req.isDemo, false);
  await M.RequirementSpec.create({ organizationId: w.o, clientId: w.client._id, requestId: req._id, version: 1, hash: 'h' });
  await assert.rejects(M.RequirementSpec.create({ organizationId: w.o, clientId: w.client._id, requestId: req._id, version: 1, hash: 'h2' }), /E11000/);
  // A client agent submission is always demo data.
  const demo = await W.createRequest({ organizationId: w.o, actor: w.A.client, clientId: w.client._id, title: 'Demo', description: 'D', source: 'CLIENT_AGENT' });
  assert.equal(demo.isDemo, true);
  // A request cannot be filed for another org's client, or a project of another client.
  const other = await world('p1-other');
  await assert.rejects(W.createRequest({ organizationId: w.o, actor: w.A.op, clientId: other.client._id, title: 'T', description: 'D' }), (e) => e.code === 'SCOPE_DENIED');
  const otherClient = await M.Client.create({ organizationId: w.org._id, name: 'Second client' });
  await assert.rejects(W.createRequest({ organizationId: w.o, actor: w.A.op, clientId: otherClient._id, projectId: w.project._id, title: 'T', description: 'D' }), /different client/);
  await assert.rejects(W.createRequest({ organizationId: w.o, actor: w.A.client, clientId: otherClient._id, title: 'T', description: 'D' }), (e) => e.code === 'SCOPE_DENIED', 'a client agent files only for its own client');
});

test('Phase 1: migration is a dry run by default, backs up first, and reverts', async (t) => {
  if (skip) return t.skip(skip);
  const { migrateWorkflowV1, revertWorkflowV1 } = await import('../../src/services/migrations/workflowV1.js');
  const w = await world('mig');
  const user = await M.User.create({ email: 'mig-user@x.test' });
  const [t1, t2] = await M.Task.create([
    { organizationId: w.org._id, projectId: w.project._id, createdBy: user._id, idempotencyKey: 'mig-0000001', instruction: 'old task 1' },
    { organizationId: w.org._id, projectId: w.project._id, createdBy: user._id, idempotencyKey: 'mig-0000002', instruction: 'old task 2' },
  ]);
  await M.Task.collection.updateOne({ _id: t2._id }, { $unset: { legacy: '' } }); // as written before the field existed
  const linked = await M.Task.create({ organizationId: w.org._id, projectId: w.project._id, createdBy: user._id, idempotencyKey: 'mig-0000003', instruction: 'workflow task', workItemId: new mongoose.Types.ObjectId() });

  const dry = await migrateWorkflowV1();
  assert.equal(dry.apply, false);
  assert.ok(dry.tasksToMarkLegacy >= 2);
  assert.equal((await M.Task.findById(t1._id).lean()).legacy, false, 'dry run writes nothing');

  const order = [];
  const applied = await migrateWorkflowV1({ apply: true, writeBackup: async (b) => { order.push(`backup:${b.tasks.length}`); assert.equal((await M.Task.findById(t1._id).lean()).legacy, false, 'backup runs before any write'); return 'mem'; } });
  assert.deepEqual(order, [`backup:${applied.backup.tasks.length}`]);
  assert.equal((await M.Task.findById(t1._id).lean()).legacy, true);
  assert.equal((await M.Task.findById(t2._id).lean()).legacy, true);
  assert.equal((await M.Task.findById(linked._id).lean()).legacy, false, 'workflow-linked tasks are not legacy');
  assert.ok(await M.AuditLog.exists({ action: 'migration.apply', target: 'workflow-v1' }));
  assert.equal((await migrateWorkflowV1()).tasksToMarkLegacy, 0, 'idempotent');

  const { restored } = await revertWorkflowV1(applied.backup);
  assert.ok(restored >= 2);
  assert.equal((await M.Task.findById(t1._id).lean()).legacy, false);
  assert.equal('legacy' in (await M.Task.collection.findOne({ _id: t2._id })), false, 'a field that did not exist is removed again');
  await assert.rejects(revertWorkflowV1({ migration: 'other' }), /not a workflow-v1 backup/);
});

test('Phase 2: happy path Request → BA → CEO → PM → heads → work → review → QA → DELIVERED', async (t) => {
  if (skip) return t.skip(skip);
  await seedCatalog();
  await workerOnline();
  const w = await world('happy');
  const { o, A } = w;
  const awaiting = await toCeo(w);
  assert.equal(awaiting.status, 'AWAITING_CEO');
  const spec = await W.currentSpec(o, awaiting._id);

  // Agents (even the CEO agent) and non-admin humans cannot decide.
  for (const actor of [A.ceoAgent, A.ba, A.pm, A.op]) {
    await assert.rejects(W.decideAsCeo({ organizationId: o, requestId: awaiting._id, actor, decision: 'APPROVED', approvedBudgetUSD: 5, priority: 'P1', deadline: new Date('2026-12-01') }), (e) => e.code === 'FORBIDDEN_ACTOR');
  }
  await assert.rejects(W.decideAsCeo({ organizationId: o, requestId: awaiting._id, actor: A.ceo, decision: 'APPROVED', approvedBudgetUSD: 5, priority: 'P1', deadline: new Date('2026-12-01'), specHash: 'stale' }), (e) => e.code === 'STALE_SPEC');
  const { request: approved, decision } = await W.decideAsCeo({ organizationId: o, requestId: awaiting._id, actor: A.ceo, decision: 'APPROVED', approvedBudgetUSD: 5, priority: 'P1', deadline: new Date('2026-12-01'), specHash: spec.hash, notes: 'Go' });
  assert.equal(approved.status, 'APPROVED');
  assert.equal(decision.specHash, spec.hash);
  assert.equal(decision.decidedByRole, 'ORG_ADMIN');

  // PM plans; a cyclic plan cannot be activated; the PM agent cannot activate.
  const cyclic = await W.savePlan({ organizationId: o, requestId: approved._id, actor: A.pmAgent, tasks: [
    { id: 'a', title: 'A', departmentSlug: 'software-engineering', requiredRole: 'frontend-engineer', dependsOn: ['b'], budgetUSD: 1 },
    { id: 'b', title: 'B', departmentSlug: 'software-engineering', requiredRole: 'backend-engineer', dependsOn: ['a'], budgetUSD: 1 },
  ] });
  await assert.rejects(W.activatePlan({ organizationId: o, planId: cyclic._id, actor: A.ceo }), /dependency cycle/);
  const plan = await W.savePlan({ organizationId: o, requestId: approved._id, actor: A.pmAgent, tasks: [
    { id: 'api', title: 'Contact endpoint', departmentSlug: 'software-engineering', requiredRole: 'backend-engineer', acceptanceCriteriaIds: ['AC-2'], budgetUSD: 1.5 },
    { id: 'web', title: 'Gallery page', departmentSlug: 'software-engineering', requiredRole: 'frontend-engineer', dependsOn: ['api'], acceptanceCriteriaIds: ['AC-1'], budgetUSD: 1.5 },
  ] });
  assert.equal(plan.version, 2);
  assert.equal((await M.ProjectPlan.findById(cyclic._id).lean()).status, 'SUPERSEDED');
  await assert.rejects(W.activatePlan({ organizationId: o, planId: plan._id, actor: A.pmAgent }), (e) => e.code === 'FORBIDDEN_ACTOR');
  const { items } = await W.activatePlan({ organizationId: o, planId: plan._id, actor: A.ceo });
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => i.status === 'PLANNED' && i.assignedHead === 'cto'));
  assert.equal((await M.ClientRequest.findById(approved._id).lean()).status, 'IN_DELIVERY');
  const api = items.find((i) => i.planTaskId === 'api');
  const web = items.find((i) => i.planTaskId === 'web');

  // Heads assign from their own department only.
  await assert.rejects(W.assignWorkItem({ organizationId: o, workItemId: api._id, actor: A.cto, agentSlug: 'seo-specialist' }), /department/);
  await assert.rejects(W.assignWorkItem({ organizationId: o, workItemId: api._id, actor: A.fe, agentSlug: 'backend-engineer' }), (e) => e.code === 'FORBIDDEN_ACTOR');
  await W.assignWorkItem({ organizationId: o, workItemId: api._id, actor: A.cto, agentSlug: 'backend-engineer' });
  await W.assignWorkItem({ organizationId: o, workItemId: web._id, actor: A.cto, agentSlug: 'frontend-engineer' });

  // Dependency gate: only "api" may start.
  let d = await W.dispatchReady({ organizationId: o, requestId: approved._id });
  assert.deepEqual(d.queued.map((i) => i.planTaskId), ['api']);
  await W.startWork({ organizationId: o, workItemId: api._id });
  await assert.rejects(W.submitWork({ organizationId: o, workItemId: api._id, actor: A.fe, outputs: [{ type: 'file', path: '<workspace>/server.js' }], evidence }), (e) => e.code === 'FORBIDDEN_ACTOR', 'only the assigned specialist submits');
  await assert.rejects(W.submitWork({ organizationId: o, workItemId: api._id, actor: A.be, outputs: [], evidence }), /at least one output/);
  await W.submitWork({ organizationId: o, workItemId: api._id, actor: A.be, outputs: [{ type: 'file', path: '<workspace>/server.js', summary: 'POST /contact' }], evidence, costUSD: 1.2, tokens: 9000 });
  await W.reviewWorkItem({ organizationId: o, workItemId: api._id, actor: A.cto, verdict: 'PASS', comments: ['Validates email server-side'] });
  await assert.rejects(W.qaWorkItem({ organizationId: o, workItemId: api._id, actor: A.qa, verdict: 'PASS', criteriaResults: [{ criterionId: 'AC-2', pass: true, evidence: 'ok' }] }), (e) => e.code === 'MISSING_DATA', '"ok" is not evidence');
  const apiDone = await W.qaWorkItem({ organizationId: o, workItemId: api._id, actor: A.qa, ...qaPass(['AC-2']) });
  assert.equal(apiDone.status, 'DONE');

  d = await W.dispatchReady({ organizationId: o, requestId: approved._id });
  assert.deepEqual(d.queued.map((i) => i.planTaskId), ['web'], 'web starts once api is DONE');
  await W.startWork({ organizationId: o, workItemId: web._id });
  await W.submitWork({ organizationId: o, workItemId: web._id, actor: A.fe, outputs: [{ type: 'file', path: '<workspace>/index.html' }], evidence, costUSD: 1.1 });
  await W.reviewWorkItem({ organizationId: o, workItemId: web._id, actor: A.cto, verdict: 'PASS', comments: ['6 cards with alt text'] });
  await W.qaWorkItem({ organizationId: o, workItemId: web._id, actor: A.qa, ...qaPass(['AC-1']) });
  assert.equal((await M.ProjectPlan.findById(plan._id).lean()).status, 'COMPLETED');

  // Delivery: the PM compiles, only the human CEO approves.
  const deliverable = await W.compileDeliverable({ organizationId: o, requestId: approved._id, actor: A.pmAgent, summaryReport: 'Portfolio site with gallery and contact form.' });
  assert.equal(deliverable.status, 'AWAITING_CEO');
  assert.equal(deliverable.items.length, 2);
  await assert.rejects(W.approveDeliverable({ organizationId: o, deliverableId: deliverable._id, actor: A.ceoAgent }), (e) => e.code === 'FORBIDDEN_ACTOR');
  const out = await W.approveDeliverable({ organizationId: o, deliverableId: deliverable._id, actor: A.ceo, notes: 'Ship it' });
  assert.equal(out.request.status, 'DELIVERED');
  assert.equal(out.deliverable.status, 'DELIVERED');
  assert.equal(out.deliverable.ceoFinalApproval.approved, true);
  const closed = await W.recordClientFeedback({ organizationId: o, deliverableId: deliverable._id, actor: A.client, verdict: 'ACCEPT', comments: ['Looks great'] });
  assert.equal(closed.request.status, 'CLOSED');

  // History + audit + timeline cover every stage.
  const tl = await W.timeline({ organizationId: o, requestId: approved._id });
  const req = tl.filter((r) => r.entity === 'request').map((r) => r.status);
  assert.deepEqual(req, ['NEW', 'IN_ANALYSIS', 'ANALYSED', 'AWAITING_CEO', 'APPROVED', 'IN_DELIVERY', 'DELIVERED', 'CLOSED']);
  assert.ok(tl.some((r) => r.entity === 'ceoDecision' && r.status === 'APPROVED' && r.by.role === 'ORG_ADMIN'));
  assert.ok(tl.some((r) => r.entity === 'workItem:web' && r.status === 'DONE' && r.by.id === 'qa-engineer'));
  assert.ok(tl.some((r) => r.entity === 'clientFeedback' && r.status === 'ACCEPT'));
  for (const action of ['workflow.request.new', 'workflow.request.approved', 'workflow.workItem.done', 'workflow.deliverable.delivered', 'workflow.request.closed']) {
    assert.ok(await M.AuditLog.exists({ organizationId: w.org._id, action }), action);
  }
  assert.equal(await M.AuditLog.countDocuments({ organizationId: w.org._id, action: 'workflow.request.approved', 'actor.kind': 'agent' }), 0, 'no agent ever approved');
});

test('Phase 2: vague request → NEEDS_CLIENT_INFO → answers → re-analysis', async (t) => {
  if (skip) return t.skip(skip);
  const w = await world('vague');
  const { o, A } = w;
  const req = await W.createRequest({ organizationId: o, actor: A.client, clientId: w.client._id, title: 'CREAT POTFLIO', description: 'CREAT POTFLIO', source: 'CLIENT_AGENT' });
  await W.move('request', { organizationId: o, id: req._id, to: 'IN_ANALYSIS', actor: A.client });
  const vague = { ...SPEC, baRecommendation: 'NEED_INFO', baReason: 'Too vague to estimate', clarifyingQuestions: [{ id: 'Q-1', question: 'Whose portfolio, and what work should it show?' }, { id: 'Q-2', question: 'Do you need a contact form?' }] };
  await W.saveSpec({ organizationId: o, requestId: req._id, actor: A.ba, spec: vague });
  await assert.rejects(W.saveSpec({ organizationId: o, requestId: req._id, actor: A.pmAgent, spec: vague }), (e) => e.code === 'FORBIDDEN_ACTOR');
  const asked = await W.concludeAnalysis({ organizationId: o, requestId: req._id, actor: A.ba });
  assert.equal(asked.status, 'NEEDS_CLIENT_INFO');
  const partial = await W.answerQuestions({ organizationId: o, requestId: req._id, actor: A.client, answers: [{ id: 'Q-1', answer: 'A freelance designer; show 6 projects' }] });
  assert.equal(partial.complete, false);
  assert.equal((await M.ClientRequest.findById(req._id).lean()).status, 'NEEDS_CLIENT_INFO');
  const full = await W.answerQuestions({ organizationId: o, requestId: req._id, actor: A.client, answers: [{ id: 'Q-2', answer: 'Yes, email only' }] });
  assert.equal(full.complete, true);
  assert.equal(full.request.status, 'IN_ANALYSIS');
  assert.equal(full.spec.version, 3, 'each answer round is a new spec version');
  await W.saveSpec({ organizationId: o, requestId: req._id, actor: A.ba, spec: { ...SPEC, clarifyingQuestions: full.spec.clarifyingQuestions } });
  assert.equal((await W.concludeAnalysis({ organizationId: o, requestId: req._id, actor: A.ba })).status, 'AWAITING_CEO');
});

test('Phase 2: CEO reject and request-changes paths', async (t) => {
  if (skip) return t.skip(skip);
  const w = await world('reject');
  const { o, A } = w;
  const a = await toCeo(w);
  await assert.rejects(W.decideAsCeo({ organizationId: o, requestId: a._id, actor: A.ceo, decision: 'CHANGES_REQUESTED' }), /notes telling the BA/);
  const changes = await W.decideAsCeo({ organizationId: o, requestId: a._id, actor: A.ceo, decision: 'CHANGES_REQUESTED', notes: 'Drop the contact form' });
  assert.equal(changes.request.status, 'IN_ANALYSIS');
  await W.saveSpec({ organizationId: o, requestId: a._id, actor: A.ba, spec: { ...SPEC, features: [SPEC.features[0]], acceptanceCriteria: [SPEC.acceptanceCriteria[0]] } });
  await W.concludeAnalysis({ organizationId: o, requestId: a._id, actor: A.ba });
  const rejected = await W.decideAsCeo({ organizationId: o, requestId: a._id, actor: A.ceo, decision: 'REJECTED', notes: 'Not now' });
  assert.equal(rejected.request.status, 'REJECTED');
  await assert.rejects(W.savePlan({ organizationId: o, requestId: a._id, actor: A.pmAgent, tasks: [] }), /after CEO approval/);
  // A rejected request cannot be resurrected by an agent.
  await assert.rejects(W.move('request', { organizationId: o, id: a._id, to: 'APPROVED', actor: A.ceoAgent }), (e) => e.code === 'INVALID_TRANSITION');
});

async function approvedWithOneItem(w, { budget = 5, itemBudget = 1 } = {}) {
  const { o, A } = w;
  const a = await toCeo(w);
  const spec = await W.currentSpec(o, a._id);
  await W.decideAsCeo({ organizationId: o, requestId: a._id, actor: A.ceo, decision: 'APPROVED', approvedBudgetUSD: budget, priority: 'P2', deadline: new Date('2026-12-01'), specHash: spec.hash });
  const plan = await W.savePlan({ organizationId: o, requestId: a._id, actor: A.pmAgent, tasks: [
    { id: 'web', title: 'Gallery', departmentSlug: 'software-engineering', requiredRole: 'frontend-engineer', acceptanceCriteriaIds: ['AC-1'], budgetUSD: itemBudget },
    { id: 'docs', title: 'README', departmentSlug: 'software-engineering', requiredRole: 'frontend-engineer', dependsOn: ['web'], acceptanceCriteriaIds: ['AC-1'], budgetUSD: itemBudget },
  ] });
  const { items } = await W.activatePlan({ organizationId: o, planId: plan._id, actor: A.ceo });
  for (const i of items) await W.assignWorkItem({ organizationId: o, workItemId: i._id, actor: A.cto, agentSlug: 'frontend-engineer' });
  return { requestId: a._id, web: items.find((i) => i.planTaskId === 'web'), docs: items.find((i) => i.planTaskId === 'docs') };
}
const runOnce = async (w, id, cost = 0.1) => {
  await W.startWork({ organizationId: w.o, workItemId: id });
  await W.submitWork({ organizationId: w.o, workItemId: id, actor: w.A.fe, outputs: [{ type: 'file', path: '<workspace>/index.html' }], evidence, costUSD: cost });
};

test('Phase 2: QA fail → REWORK to the same specialist → pass; third failure → BLOCKED + human escalation', async (t) => {
  if (skip) return t.skip(skip);
  await seedCatalog();
  await workerOnline();
  const w = await world('rework');
  const { o, A } = w;
  const { requestId, web, docs } = await approvedWithOneItem(w);

  await W.dispatchReady({ organizationId: o, requestId });
  await runOnce(w, web._id);
  await W.reviewWorkItem({ organizationId: o, workItemId: web._id, actor: A.cto, verdict: 'PASS', comments: ['Layout fine'] });
  const failed = await W.qaWorkItem({ organizationId: o, workItemId: web._id, actor: A.qa, verdict: 'FAIL', criteriaResults: [{ criterionId: 'AC-1', pass: false, evidence: 'DOM test: 4 of 6 cards have alt text' }] });
  assert.equal(failed.status, 'REWORK');
  assert.equal(failed.attempts, 1);
  assert.equal(failed.assignedAgent, 'frontend-engineer', 'rework stays with the same specialist');
  assert.match(failed.qaResults.at(-1).criteriaResults[0].evidence, /4 of 6/);
  await W.dispatchReady({ organizationId: o, requestId });
  await runOnce(w, web._id);
  await W.reviewWorkItem({ organizationId: o, workItemId: web._id, actor: A.cto, verdict: 'PASS', comments: ['Alt text added'] });
  const passed = await W.qaWorkItem({ organizationId: o, workItemId: web._id, actor: A.qa, ...qaPass(['AC-1']) });
  assert.equal(passed.status, 'DONE');

  // docs fails review three times → BLOCKED with an Approvals-inbox escalation.
  for (let attempt = 1; attempt <= 3; attempt++) {
    await W.dispatchReady({ organizationId: o, requestId });
    await runOnce(w, docs._id);
    const r = await W.reviewWorkItem({ organizationId: o, workItemId: docs._id, actor: A.cto, verdict: 'FAIL', comments: [`README missing run steps (attempt ${attempt})`] });
    assert.equal(r.status, attempt < 3 ? 'REWORK' : 'BLOCKED');
  }
  const blocked = await M.WorkItem.findById(docs._id).lean();
  assert.equal(blocked.blockedReason, 'ATTEMPT_LIMIT');
  assert.equal(blocked.reviews.length, 3);
  const esc = await M.Approval.findById(blocked.escalationApprovalId).lean();
  assert.equal(esc.status, 'PENDING');
  assert.equal(esc.action, 'workflow.escalation');
  assert.equal((await W.dispatchReady({ organizationId: o, requestId })).queued.length, 0, 'a blocked item is never dispatched');
  // Only a human unblocks; the attempt counter resets and the escalation closes.
  await assert.rejects(W.unblockWorkItem({ organizationId: o, workItemId: docs._id, actor: A.cto }), (e) => e.code === 'FORBIDDEN_ACTOR');
  const unblocked = await W.unblockWorkItem({ organizationId: o, workItemId: docs._id, actor: A.pm, note: 'Clarified README requirements' });
  assert.equal(unblocked.status, 'ASSIGNED');
  assert.equal(unblocked.attempts, 0);
  assert.equal((await M.Approval.findById(esc._id).lean()).status, 'CONSUMED');
});

test('Phase 2: budget guard pauses remaining work until the human CEO raises the budget', async (t) => {
  if (skip) return t.skip(skip);
  await seedCatalog();
  await workerOnline();
  const w = await world('budget');
  const { o, A } = w;
  const { requestId, web, docs } = await approvedWithOneItem(w, { budget: 2, itemBudget: 1 });
  await W.dispatchReady({ organizationId: o, requestId });
  await runOnce(w, web._id, 2.5); // overspend
  const docsNow = await M.WorkItem.findById(docs._id).lean();
  assert.equal(docsNow.status, 'BLOCKED');
  assert.equal(docsNow.blockedReason, 'BUDGET_EXCEEDED');
  await assert.rejects(W.unblockWorkItem({ organizationId: o, workItemId: docs._id, actor: A.pm }), (e) => e.code === 'BUDGET_EXCEEDED');
  await assert.rejects(W.raiseBudget({ organizationId: o, requestId, actor: A.pm, approvedBudgetUSD: 10 }), (e) => e.code === 'FORBIDDEN_ACTOR');
  await assert.rejects(W.raiseBudget({ organizationId: o, requestId, actor: A.ceoAgent, approvedBudgetUSD: 10 }), (e) => e.code === 'FORBIDDEN_ACTOR');
  await W.raiseBudget({ organizationId: o, requestId, actor: A.ceo, approvedBudgetUSD: 10, notes: 'Worth it' });
  assert.equal((await W.unblockWorkItem({ organizationId: o, workItemId: docs._id, actor: A.pm })).status, 'ASSIGNED');
  assert.ok(await M.AuditLog.exists({ organizationId: w.org._id, action: 'workflow.budget.raise' }));
});

test('Phase 2: worker offline holds dispatch; cross-org records are not found', async (t) => {
  if (skip) return t.skip(skip);
  await seedCatalog();
  await workerOnline();
  const w = await world('offline');
  const { o, A } = w;
  const { requestId, web } = await approvedWithOneItem(w);
  await workerOffline();
  const held = await W.dispatchReady({ organizationId: o, requestId });
  assert.equal(held.queued.length, 0);
  assert.equal(held.workerOnline, false);
  assert.ok(held.held.some((h) => h.workItemId === String(web._id) && h.code === 'WORKER_OFFLINE'));
  assert.equal((await M.WorkItem.findById(web._id).lean()).status, 'ASSIGNED');
  await workerOnline();
  assert.equal((await W.dispatchReady({ organizationId: o, requestId })).queued.length, 1);

  const intruder = await world('intruder');
  await assert.rejects(W.move('workItem', { organizationId: intruder.o, id: web._id, to: 'CANCELLED', actor: intruder.A.op }), (e) => e.code === 'SCOPE_DENIED' && e.status === 404);
  // Even with the right org id in the call, an actor from another org is refused.
  await assert.rejects(W.move('workItem', { organizationId: o, id: web._id, to: 'CANCELLED', actor: intruder.A.op }), (e) => e.code === 'SCOPE_DENIED');
  await assert.rejects(W.timeline({ organizationId: intruder.o, requestId }), (e) => e.code === 'SCOPE_DENIED');
  // Concurrent moves: only one wins.
  const results = await Promise.allSettled([
    W.move('workItem', { organizationId: o, id: web._id, to: 'IN_PROGRESS', actor: A.system }),
    W.move('workItem', { organizationId: o, id: web._id, to: 'IN_PROGRESS', actor: A.system }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
});

test('Phase 2: change request after delivery goes back to the BA', async (t) => {
  if (skip) return t.skip(skip);
  await seedCatalog();
  await workerOnline();
  const w = await world('change');
  const { o, A } = w;
  const { requestId, web, docs } = await approvedWithOneItem(w, { budget: 10 });
  for (const item of [web, docs]) {
    await W.dispatchReady({ organizationId: o, requestId });
    await runOnce(w, item._id);
    await W.reviewWorkItem({ organizationId: o, workItemId: item._id, actor: A.cto, verdict: 'PASS', comments: ['ok for QA'] });
    await W.qaWorkItem({ organizationId: o, workItemId: item._id, actor: A.qa, ...qaPass(['AC-1']) });
  }
  const del = await W.compileDeliverable({ organizationId: o, requestId, actor: A.pmAgent, summaryReport: 'Gallery + README' });
  await W.approveDeliverable({ organizationId: o, deliverableId: del._id, actor: A.ceo });
  const other = await world('change-other');
  await assert.rejects(W.recordClientFeedback({ organizationId: o, deliverableId: del._id, actor: { ...A.client, clientId: String(other.client._id) }, verdict: 'ACCEPT' }), (e) => e.code === 'SCOPE_DENIED');
  await assert.rejects(W.recordClientFeedback({ organizationId: o, deliverableId: del._id, actor: A.client, verdict: 'CHANGES_REQUESTED', comments: [] }), /specific change requests/);
  const cr = await W.recordClientFeedback({ organizationId: o, deliverableId: del._id, actor: A.client, verdict: 'CHANGES_REQUESTED', comments: ['Add a dark mode'] });
  assert.equal(cr.request.status, 'IN_ANALYSIS');
  assert.equal((await M.Deliverable.findById(del._id).lean()).status, 'CHANGES_REQUESTED');
});
