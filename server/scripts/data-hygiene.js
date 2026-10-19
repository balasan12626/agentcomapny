// One-off clean-up of records created before clients and isolated workspaces
// were enforced. DRY RUN by default; pass --apply to write.
//   1. archive scripted sandbox projects ("Sandbox Live Run <n>") under a "Sandbox (test runs)" client
//   2. attach remaining client-less projects to an "Internal" client
//   3. give every project that shares (or nests in) another project's folder its own folder
//   4. close agent runs still open under finished tasks
// Before applying, every touched document is written to .data-backups/; every
// change is audited (actor system:data-hygiene) with its before/after values.
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import { Project, Client, Task, AgentRun, AuditLog } from '../src/models/index.js';
import { rootsOverlap, slugify } from '../src/core/workspaceIsolation.js';
import { TERMINAL_STATES } from '../src/core/taskStateMachine.js';
import { APP_ROOT } from '../src/services/workspaces.js';

const APPLY = process.argv.includes('--apply');
const SANDBOX = /^Sandbox Live Run \d+$/;
const actor = { kind: 'system', id: 'data-hygiene' };
const plan = [];
const say = (s) => console.log(`${APPLY ? '•' : '(dry run) •'} ${s}`);

await connectDb();
const projects = await Project.find({}).sort({ createdAt: 1 });
const clients = await Client.find({});
const backup = { at: new Date().toISOString(), projects: projects.map((p) => p.toObject()), clients: clients.map((c) => c.toObject()), runs: [] };

async function clientNamed(organizationId, name) {
  let c = clients.find((x) => String(x.organizationId) === String(organizationId) && x.name === name);
  if (!c && APPLY) { c = await Client.create({ organizationId, name }); clients.push(c); await AuditLog.create({ organizationId, actor, action: 'client.create', target: String(c._id), details: { reason: 'data hygiene' } }); }
  return c || { _id: null, name };
}

// 1 + 2: hierarchy
for (const p of projects) {
  if (SANDBOX.test(p.name) && !p.archivedAt) {
    const c = await clientNamed(p.organizationId, 'Sandbox (test runs)');
    say(`archive "${p.name}" and file it under client "${c.name}"`);
    plan.push({ p, set: { archivedAt: new Date(), ...(p.clientId ? {} : { clientId: c._id }) }, why: 'sandbox archive' });
  } else if (!p.clientId) {
    const c = await clientNamed(p.organizationId, 'Internal');
    say(`attach "${p.name}" to client "${c.name}"`);
    plan.push({ p, set: { clientId: c._id }, why: 'orphan → client' });
  }
}

// 3: isolation among projects that stay active
const archivedIds = new Set(plan.filter((x) => x.set.archivedAt).map((x) => String(x.p._id)));
const active = projects.filter((p) => !p.archivedAt && !archivedIds.has(String(p._id)) && p.workspace?.allowedRoots?.length);
const completedIn = new Set((await Task.find({ status: 'COMPLETED', kind: { $ne: 'chat' } }).distinct('projectId')).map(String));
const taken = [];
for (const p of [...active].sort((a, b) => Number(completedIn.has(String(b._id))) - Number(completedIn.has(String(a._id))) || a.createdAt - b.createdAt)) {
  const roots = p.workspace.allowedRoots;
  const inApp = roots.some((r) => rootsOverlap(r, APP_ROOT));
  const clash = taken.find((t) => roots.some((r) => rootsOverlap(r, t.root)));
  if (!clash && !inApp) { taken.push(...roots.map((root) => ({ root, name: p.name }))); continue; }
  const clientId = plan.find((x) => x.p === p)?.set.clientId || p.clientId;
  const clientName = clients.find((c) => String(c._id) === String(clientId))?.name || 'internal';
  const base = process.env.WORKSPACE_BASE || path.dirname(roots[0]);
  const next = path.join(base, slugify(clientName), slugify(p.name));
  say(`move "${p.name}" from ${roots.join(', ')} (${inApp ? 'inside the DATYLUNE app' : `shared with "${clash.name}"`}) to its own folder ${next}`);
  const entry = plan.find((x) => x.p === p) || (plan.push({ p, set: {}, why: '' }), plan[plan.length - 1]);
  entry.set['workspace.allowedRoots'] = [next];
  entry.why = [entry.why, 'workspace isolation'].filter(Boolean).join(' + ');
  entry.mkdir = next;
  taken.push({ root: next, name: p.name });
}

// 4: open runs under finished tasks
const finished = await Task.find({ status: { $in: TERMINAL_STATES } }, { status: 1 }).lean();
const openRuns = await AgentRun.find({ taskId: { $in: finished.map((t) => t._id) }, status: { $in: ['QUEUED', 'RUNNING', 'AWAITING_APPROVAL'] } });
for (const r of openRuns) {
  const t = finished.find((x) => String(x._id) === String(r.taskId));
  say(`close run ${String(r._id).slice(-6)} (${r.agentSlug}, ${r.status}) — its task is ${t.status}`);
  backup.runs.push(r.toObject());
}

if (!plan.length && !openRuns.length) say('nothing to change');
if (APPLY && (plan.length || openRuns.length)) {
  const dir = path.join(APP_ROOT, '.data-backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `data-hygiene-${backup.at.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(backup, null, 2));
  console.log(`backup written: ${file}`);
  for (const { p, set, why, mkdir } of plan) {
    if (mkdir) fs.mkdirSync(mkdir, { recursive: true });
    const before = { clientId: p.clientId ? String(p.clientId) : null, roots: [...(p.workspace?.allowedRoots || [])], archivedAt: p.archivedAt };
    await Project.updateOne({ _id: p._id }, { $set: set });
    await AuditLog.create({ organizationId: p.organizationId, actor, action: 'project.update', target: String(p._id), details: { reason: why, before, set } });
  }
  for (const r of openRuns) {
    const t = finished.find((x) => String(x._id) === String(r.taskId));
    await AgentRun.updateOne({ _id: r._id }, { $set: { status: t.status === 'COMPLETED' ? 'FAILED' : t.status, finishedAt: r.finishedAt || new Date(), error: `closed by data hygiene: task ${t.status}` } });
    await AuditLog.create({ organizationId: r.organizationId, actor, action: 'run.reconcile', target: String(r.taskId), details: { runId: String(r._id), from: r.status, taskStatus: t.status } });
  }
  console.log(`applied ${plan.length} project change(s), closed ${openRuns.length} run(s)`);
} else if (!APPLY && (plan.length || openRuns.length)) console.log('\nDry run only. Re-run with --apply to write these changes (a backup is taken first).');
await mongoose.disconnect();
