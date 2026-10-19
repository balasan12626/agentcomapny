// Phase 3 (docs/PHASES.md): agent steps run through the real worker path —
// processTask → executeTask → (scripted) Claude runner → schema validation →
// services/workflow.js. Only the Claude CLI is replaced, by a script that
// answers like each role would and writes real files into the workspace.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import mongoose from 'mongoose';

process.env.SESSION_SECRET = 'test-secret-'.padEnd(40, 'x');
process.env.NODE_ENV = 'test';

let mem;
let skip = false;
let M; let W; let WA; let processTask; let executeTask;

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
  await mongoose.connect(uri.replace(/\/([^/?]*)(\?|$)/, (m, db, q) => `/${db || 'test'}_agents${q}`));
  await mongoose.connection.db.dropDatabase();
  M = await import('../../src/models/index.js');
  W = await import('../../src/services/workflow.js');
  WA = await import('../../src/services/workflowAgents.js');
  ({ processTask } = await import('../../src/queue/worker.js'));
  ({ executeTask } = await import('../../src/services/orchestrator.js'));
  await Promise.all(Object.values(M).filter((x) => x?.createIndexes).map((x) => x.createIndexes()));
  await seedCatalog();
});
after(async () => {
  if (mongoose.connection.readyState) { await mongoose.connection.db.dropDatabase(); await mongoose.disconnect(); }
  await mem?.stop();
});

async function seedCatalog() {
  await M.Department.create([
    { slug: 'software-engineering', name: 'Software Engineering', head: { slug: 'cto', title: 'CTO' }, order: 0 },
    { slug: 'qa-devops-cloud', name: 'QA', head: { slug: 'vp-eng-ops', title: 'VP Eng Ops' }, order: 1 },
    { slug: 'marketing', name: 'Marketing', head: { slug: 'cmo', title: 'CMO' }, order: 2 },
  ]);
  const agents = [
    ['founder-ceo', 'EXECUTIVE', null], ['business-analyst', 'CORE_ROLE', 'product-delivery'], ['project-manager', 'CORE_ROLE', 'product-delivery'],
    ['cto', 'DEPARTMENT_HEAD', 'software-engineering'], ['frontend-engineer', 'CORE_ROLE', 'software-engineering'], ['backend-engineer', 'CORE_ROLE', 'software-engineering'],
    ['qa-engineer', 'CORE_ROLE', 'qa-devops-cloud'], ['seo-specialist', 'CORE_ROLE', 'marketing'],
  ];
  for (const [slug, kind, departmentSlug] of agents) {
    const a = await M.Agent.create({ slug, name: slug, department: departmentSlug || 'Executive', kind, departmentSlug, publishedVersion: 1 });
    await M.AgentVersion.create({ agentId: a._id, version: 1, status: 'PUBLISHED', allowedTools: ['Read'] });
  }
}
const workerOnline = () => M.WorkerHeartbeat.updateOne({ workerId: 'agents-worker' }, { $set: { lastSeenAt: new Date(Date.now() + 3600_000), concurrency: 2, activeJobs: 0 } }, { upsert: true });

async function world(slug) {
  const org = await M.Organization.create({ name: slug, slug });
  const ceo = await M.User.create({ email: `ceo@${slug}.test` });
  const membership = await M.Membership.create({ organizationId: org._id, userId: ceo._id, role: 'ORG_ADMIN' });
  const client = await M.Client.create({ organizationId: org._id, name: `${slug} client` });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dl-wf-${slug}-`));
  const project = await M.Project.create({ organizationId: org._id, clientId: client._id, name: `${slug} site`, workspace: { allowedRoots: [root] } });
  return { org, o: String(org._id), client, project, root, ceo: W.userActor(ceo, membership) };
}

// ── Scripted Claude: one handler per role, recognised from its prompt ──────
const STEP_OF = [
  [/You are the Business Analyst/, 'ba.analyse'], [/Founder\/CEO agent/, 'ceo.brief'], [/Break the approved requirements/, 'pm.plan'],
  [/Write the delivery report/, 'pm.deliverable'], [/Assign this task to ONE specialist/, 'head.assign'], [/Review this submission/, 'head.review'],
  [/You are the QA engineer/, 'qa.verify'], [/specialist\. Do ONLY this task/, 'specialist.work'],
];
function scripted(handlers, log) {
  return (options, { cwd }) => {
    const step = STEP_OF.find(([re]) => re.test(options.prompt))?.[1];
    log.push({ step, prompt: options.prompt });
    const h = handlers[step];
    const reply = typeof h === 'function' ? h(options.prompt, cwd, log.filter((l) => l.step === step).length) : h;
    if (reply === undefined) throw new Error(`no scripted reply for ${step}`);
    const text = typeof reply === 'string' ? reply : `\`\`\`json\n${JSON.stringify(reply)}\n\`\`\``;
    return { events: new EventEmitter(), done: Promise.resolve({ ok: true, usage: { inputTokens: 50, outputTokens: 50, costUsd: 0.01, turns: 1 }, sessionId: `s-${log.length}`, final: { summary: text } }) };
  };
}
function queue(runner) {
  const jobs = [];
  const enqueue = async (j) => { jobs.push(j); };
  const drain = async (limit = 60) => {
    let n = 0;
    while (jobs.length) {
      if (++n > limit) throw new Error('workflow did not settle');
      await processTask(jobs.shift(), { execute: (d) => executeTask({ ...d, runner }), enqueue });
    }
    return n;
  };
  return { jobs, enqueue, drain };
}

const SPEC = {
  summary: 'One-page portfolio for a freelance designer', businessGoal: 'Win client enquiries', targetUsers: ['prospective clients'],
  scope: { inScope: ['gallery', 'contact endpoint'], outOfScope: ['blog'] },
  features: [{ id: 'F-1', title: 'Gallery', description: 'Grid of six projects', priority: 'MUST' }, { id: 'F-2', title: 'Contact API', description: 'POST /contact validates email', priority: 'MUST' }],
  acceptanceCriteria: [
    { id: 'AC-1', featureId: 'F-1', criterion: 'index.html shows 6 project cards with alt text', testMethod: 'DOM test counting .card img[alt]' },
    { id: 'AC-2', featureId: 'F-2', criterion: 'server.js rejects an invalid email with HTTP 400', testMethod: 'node --test contact.test.js' },
  ],
  clarifyingQuestions: [], risks: ['Image licensing'], assumptions: ['Static hosting'],
  estimate: { effortHours: 6, costUSD: 2, durationDays: 2, departmentsNeeded: ['software-engineering'] },
  baRecommendation: 'ACCEPT', baReason: 'Clear once the client answered',
};
const PLAN = { milestones: [{ id: 'm1', title: 'Launch', dueDate: '2026-11-30' }], tasks: [
  { id: 'api', title: 'Contact endpoint', description: 'Build server.js with POST /contact', departmentSlug: 'software-engineering', requiredRole: 'backend-engineer', dependsOn: [], acceptanceCriteriaIds: ['AC-2'], estimateHours: 2, budgetUSD: 1 },
  { id: 'web', title: 'Gallery page', description: 'Build index.html with 6 cards', departmentSlug: 'software-engineering', requiredRole: 'frontend-engineer', dependsOn: ['api'], acceptanceCriteriaIds: ['AC-1'], estimateHours: 2, budgetUSD: 1 },
] };
const planIdOf = (prompt) => /\(plan id ([a-z0-9-]+)\)/.exec(prompt)?.[1];
const FILE_OF = { api: 'server.js', web: 'index.html' };
const specialist = (prompt, cwd) => {
  const id = planIdOf(prompt);
  fs.writeFileSync(path.join(cwd, FILE_OF[id]), `// ${id} built by the scripted specialist\n`);
  return { summary: `Implemented ${id}`, outputs: [{ type: 'file', path: FILE_OF[id], summary: `${id} implementation` }], evidence: [{ type: 'test-output', content: `node --test ${id}.test.js: 3 passing, 0 failing` }] };
};
const qaFor = (prompt, pass) => {
  const ids = [...prompt.matchAll(/^- (AC-\d+):/gm)].map((m) => m[1]);
  return { verdict: pass ? 'PASS' : 'FAIL', criteriaResults: ids.map((criterionId) => ({ criterionId, pass, evidence: pass ? `${criterionId}: node --test passed 3/3 in the workspace` : `${criterionId}: invalid email returned 200 instead of 400` })) };
};

test('Phase 3: the whole company runs through the worker — BA asks, retries, CEO decides, PM plans, heads assign and review, QA sends rework, PM delivers', async (t) => {
  if (skip) return t.skip(skip);
  await workerOnline();
  const w = await world('e2e');
  const log = [];
  let qaCalls = 0;
  const handlers = {
    'ba.analyse': (prompt, _cwd, n) => (n === 1
      ? { ...SPEC, features: [], acceptanceCriteria: [], baRecommendation: 'NEED_INFO', baReason: 'Request is too vague', clarifyingQuestions: [{ id: 'Q-1', question: 'Whose portfolio is it and what must it show?' }] }
      : n === 2 ? 'Sure! The spec is mostly done, I will send it later.' // invalid → one retry
        : SPEC),
    'ceo.brief': { summary: 'Small, well-defined portfolio build; two tasks.', risks: ['Image licensing'], recommendedBudgetUSD: 3, recommendedPriority: 'P2', recommendation: 'APPROVE', rationale: 'Clear scope and low cost' },
    'pm.plan': PLAN,
    'head.assign': (prompt) => ({ agentSlug: planIdOf(prompt) === 'api' ? 'backend-engineer' : 'frontend-engineer', reason: 'Best fit for the required role' }),
    'specialist.work': specialist,
    'head.review': { verdict: 'PASS', comments: ['Meets the listed criteria; send to QA'] },
    'qa.verify': (prompt) => { qaCalls++; return qaFor(prompt, qaCalls !== 1); }, // first QA run fails → rework
    'pm.deliverable': { summaryReport: '# Delivery\n\n- server.js: POST /contact (AC-2 verified by node --test)\n- index.html: gallery (AC-1 verified by DOM test)\n\nRun: node server.js' },
  };
  const runner = scripted(handlers, log);
  const { enqueue, drain } = queue(runner);
  const { o } = w;

  const req = await W.createRequest({ organizationId: o, actor: w.ceo, clientId: w.client._id, projectId: w.project._id, title: 'CREAT POTFLIO', description: 'CREAT POTFLIO' });
  await W.move('request', { organizationId: o, id: req._id, to: 'IN_ANALYSIS', actor: w.ceo });
  assert.deepEqual((await WA.advance({ organizationId: o, requestId: req._id, enqueue })).scheduled.map((s) => s.step), ['ba.analyse']);
  await drain();
  assert.equal((await M.ClientRequest.findById(req._id).lean()).status, 'NEEDS_CLIENT_INFO', 'vague request → BA asks instead of guessing');
  assert.match(log[0].prompt, /<client_request>\nTitle: CREAT POTFLIO/);

  await W.answerQuestions({ organizationId: o, requestId: req._id, actor: w.ceo, answers: [{ id: 'Q-1', answer: 'Mine (freelance designer): 6 projects and a contact form' }] });
  await WA.advance({ organizationId: o, requestId: req._id, enqueue });
  await drain();
  const baPrompts = log.filter((l) => l.step === 'ba.analyse');
  assert.equal(baPrompts.length, 3, 'NEED_INFO, then an invalid reply, then the retry');
  assert.match(baPrompts[1].prompt, /<client_answers>[\s\S]*6 projects and a contact form/);
  assert.match(baPrompts[2].prompt, /PREVIOUS REPLY WAS REJECTED[\s\S]*no JSON object/);
  let request = await M.ClientRequest.findById(req._id).lean();
  assert.equal(request.status, 'AWAITING_CEO');
  const spec = await W.currentSpec(o, req._id);
  assert.ok(spec.clarifyingQuestions.some((q) => q.id === 'Q-1' && q.answer), 'answered question kept');
  assert.equal(request.ceoBrief.recommendation, 'APPROVE', 'CEO agent wrote a brief…');
  assert.equal(request.ceoBrief.specVersion, spec.version);
  assert.equal(await M.CeoDecision.countDocuments({ requestId: req._id }), 0, '…but made no decision');

  // Human CEO approves; the PM plans; a human activates the plan.
  await W.decideAsCeo({ organizationId: o, requestId: req._id, actor: w.ceo, decision: 'APPROVED', approvedBudgetUSD: 5, priority: 'P2', deadline: new Date('2026-12-01'), specHash: spec.hash });
  await WA.advance({ organizationId: o, requestId: req._id, enqueue });
  await drain();
  const plan = await M.ProjectPlan.findOne({ requestId: req._id }).lean();
  assert.equal(plan.status, 'DRAFT');
  assert.equal(plan.writtenBy.id, 'project-manager');
  await W.activatePlan({ organizationId: o, planId: plan._id, actor: w.ceo });
  await WA.advance({ organizationId: o, requestId: req._id, enqueue });
  await drain(80);

  const items = await M.WorkItem.find({ requestId: req._id }).lean();
  const api = items.find((i) => i.planTaskId === 'api');
  const web = items.find((i) => i.planTaskId === 'web');
  assert.deepEqual(items.map((i) => i.status), ['DONE', 'DONE']);
  assert.equal(api.assignedAgent, 'backend-engineer');
  assert.equal(api.assignedBy.id, 'cto', 'the CTO agent assigned it');
  assert.equal(web.assignedAgent, 'frontend-engineer');
  assert.equal(api.attempts, 1, 'api went through one QA rework');
  assert.ok(fs.existsSync(path.join(w.root, 'server.js')) && fs.existsSync(path.join(w.root, 'index.html')), 'real files in the workspace');
  assert.deepEqual(api.outputs.map((x) => x.path), ['<workspace>/server.js']);
  assert.ok(api.costUSD > 0 && api.taskIds.length >= 4, 'assign + 2 work + 2 review + 2 QA runs charged to the item');
  const specialistPrompts = log.filter((l) => l.step === 'specialist.work' && planIdOf(l.prompt) === 'api');
  assert.equal(specialistPrompts.length, 2);
  assert.match(specialistPrompts[1].prompt, /THIS IS REWORK — attempt 2[\s\S]*QA AC-2 \(qa-engineer\): AC-2: invalid email returned 200/, 'QA comments injected into the rework prompt');
  // Dependency order: web's specialist ran only after api was DONE.
  const firstWeb = log.findIndex((l) => l.step === 'specialist.work' && planIdOf(l.prompt) === 'web');
  const lastApiQa = log.map((l, i) => [l, i]).filter(([l]) => l.step === 'qa.verify' && /plan id api/.test(l.prompt)).at(-1)[1];
  assert.ok(firstWeb > lastApiQa);

  const deliverable = await M.Deliverable.findOne({ requestId: req._id }).lean();
  assert.equal(deliverable.status, 'AWAITING_CEO');
  assert.equal(deliverable.items.length, 2);
  assert.match(deliverable.summaryReport, /AC-2 verified/);
  const done = await W.approveDeliverable({ organizationId: o, deliverableId: deliverable._id, actor: w.ceo });
  assert.equal(done.request.status, 'DELIVERED');

  const wfTasks = await M.Task.find({ organizationId: w.org._id, kind: 'workflow' }).lean();
  assert.equal(wfTasks.filter((x) => x.workflow.outcome === 'INVALID').length, 1, 'exactly the one bad BA reply');
  assert.ok(wfTasks.every((x) => ['APPLIED', 'INVALID'].includes(x.workflow.outcome)), 'every step was processed');
  assert.ok(wfTasks.every((x) => x.status === 'COMPLETED'));
  assert.ok(await M.AuditLog.exists({ organizationId: w.org._id, action: 'workflow.step.invalid' }));
  assert.ok((await M.AuditLog.countDocuments({ organizationId: w.org._id, action: 'workflow.step.applied' })) >= 12);
});

test('Phase 3: invalid output twice blocks the item; claimed files must really exist; heads assign only within their department', async (t) => {
  if (skip) return t.skip(skip);
  await workerOnline();
  const w = await world('invalid');
  const { o } = w;
  const log = [];
  const handlers = {
    'ba.analyse': { ...SPEC, acceptanceCriteria: [SPEC.acceptanceCriteria[0]], features: [SPEC.features[0]] },
    'ceo.brief': { summary: 'Small gallery build with one task.', risks: [], recommendedBudgetUSD: 2, recommendedPriority: 'P3', recommendation: 'APPROVE', rationale: 'Tiny scope' },
    'pm.plan': { tasks: [{ ...PLAN.tasks[1], dependsOn: [] }] },
    // First pick is outside the CTO's department → rejected, retried with the reason.
    'head.assign': (_p, _c, n) => ({ agentSlug: n === 1 ? 'seo-specialist' : 'frontend-engineer', reason: 'Picked for the gallery work' }),
    // Claims a file it never wrote — twice.
    'specialist.work': { summary: 'Built the gallery page', outputs: [{ type: 'file', path: 'index.html', summary: 'gallery' }], evidence: [{ type: 'test-output', content: 'node --test: 1 passing' }] },
  };
  const { enqueue, drain } = queue(scripted(handlers, log));
  const req = await W.createRequest({ organizationId: o, actor: w.ceo, clientId: w.client._id, projectId: w.project._id, title: 'Gallery', description: 'A gallery page with six projects.' });
  await W.move('request', { organizationId: o, id: req._id, to: 'IN_ANALYSIS', actor: w.ceo });
  await WA.advance({ organizationId: o, requestId: req._id, enqueue });
  await drain();
  const spec = await W.currentSpec(o, req._id);
  await W.decideAsCeo({ organizationId: o, requestId: req._id, actor: w.ceo, decision: 'APPROVED', approvedBudgetUSD: 3, priority: 'P3', deadline: new Date('2026-12-01'), specHash: spec.hash });
  await WA.advance({ organizationId: o, requestId: req._id, enqueue });
  await drain();
  const plan = await M.ProjectPlan.findOne({ requestId: req._id }).lean();
  await W.activatePlan({ organizationId: o, planId: plan._id, actor: w.ceo });
  await WA.advance({ organizationId: o, requestId: req._id, enqueue });
  await drain();

  const assignPrompts = log.filter((l) => l.step === 'head.assign');
  assert.equal(assignPrompts.length, 2);
  assert.match(assignPrompts[1].prompt, /PREVIOUS REPLY WAS REJECTED[\s\S]*department/);
  const item = await M.WorkItem.findOne({ requestId: req._id }).lean();
  assert.equal(item.assignedAgent, 'frontend-engineer');
  assert.equal(item.status, 'BLOCKED');
  assert.equal(item.blockedReason, 'INVALID_OUTPUT');
  assert.equal(log.filter((l) => l.step === 'specialist.work').length, 2, 'one retry, then blocked');
  assert.match(log.filter((l) => l.step === 'specialist.work')[1].prompt, /output file index\.html does not exist in the workspace/);
  const esc = await M.Approval.findById(item.escalationApprovalId).lean();
  assert.equal(esc.status, 'PENDING');
  assert.equal(esc.action, 'workflow.escalation');
  const invalid = await M.Task.find({ organizationId: w.org._id, 'workflow.outcome': 'INVALID' }).lean();
  assert.ok(invalid.some((x) => x.workflow.issues.some((i) => /not allowed|department/.test(i))));
});

test('Phase 3: BA invalid twice returns the request to NEW and escalates; worker offline queues nothing', async (t) => {
  if (skip) return t.skip(skip);
  await workerOnline();
  const w = await world('ba-fail');
  const { o } = w;
  const log = [];
  const { jobs, enqueue, drain } = queue(scripted({ 'ba.analyse': { summary: 'x' } }, log));
  const req = await W.createRequest({ organizationId: o, actor: w.ceo, clientId: w.client._id, projectId: w.project._id, title: 'Shop', description: 'An online shop for handmade soap.' });
  await W.move('request', { organizationId: o, id: req._id, to: 'IN_ANALYSIS', actor: w.ceo });
  await WA.advance({ organizationId: o, requestId: req._id, enqueue });
  await drain();
  assert.equal(log.length, 2);
  assert.equal((await M.ClientRequest.findById(req._id).lean()).status, 'NEW');
  assert.ok(await M.Approval.exists({ organizationId: w.org._id, action: 'workflow.escalation', target: `request:${req._id}`, status: 'PENDING' }));

  await M.WorkerHeartbeat.deleteMany({});
  await W.move('request', { organizationId: o, id: req._id, to: 'IN_ANALYSIS', actor: w.ceo });
  assert.deepEqual(await WA.advance({ organizationId: o, requestId: req._id, enqueue }), { scheduled: [], held: 'WORKER_OFFLINE' });
  await assert.rejects(WA.scheduleStep({ organizationId: o, step: 'ba.analyse', refId: req._id, enqueue }), (e) => e.code === 'WORKER_OFFLINE');
  assert.equal(jobs.length, 0);

  // No project → agents never run.
  await workerOnline();
  const noProject = await W.createRequest({ organizationId: o, actor: w.ceo, clientId: w.client._id, title: 'Loose', description: 'No project chosen yet.' });
  await W.move('request', { organizationId: o, id: noProject._id, to: 'IN_ANALYSIS', actor: w.ceo });
  const r = await WA.advance({ organizationId: o, requestId: noProject._id, enqueue });
  assert.equal(r.scheduled.length, 0);
  assert.match(r.problems[0].reason, /needs a project with a workspace/);
  // Another org's record is not found.
  const other = await world('ba-other');
  await assert.rejects(WA.scheduleStep({ organizationId: other.o, step: 'ba.analyse', refId: req._id, enqueue }), (e) => e.code === 'SCOPE_DENIED');
});
