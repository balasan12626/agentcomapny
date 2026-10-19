import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Project, Client, WorkerHeartbeat } from '../models/index.js';
import { validateRootShape, findWorkspaceConflicts, defaultWorkspaceRoot } from '../core/workspaceIsolation.js';
import { workerStatus } from '../core/staleness.js';

// The DATYLUNE source tree. No project workspace may contain it or live in it.
export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const protectedRoots = () => [APP_ROOT, ...(process.env.PROTECTED_ROOTS || '').split(';').map((s) => s.trim()).filter(Boolean)];

export class WorkspaceError extends Error {
  constructor(message, status, details) { super(message); this.status = status; this.code = 'WORKSPACE_INVALID'; this.details = details; }
}

// Validate requested roots for a project. Overlap is checked against every
// project on this machine (all organizations): the filesystem is shared even
// when tenants are not. Other tenants' project names are never disclosed.
export async function assertIsolatedRoots({ organizationId, roots, excludeProjectId }) {
  for (const root of roots) {
    const problem = validateRootShape(root, { protectedRoots: protectedRoots() });
    if (problem) throw new WorkspaceError(problem, 422);
  }
  if (new Set(roots.map((r) => r.toLowerCase())).size !== roots.length) throw new WorkspaceError('duplicate workspace roots', 422);
  const filter = { 'workspace.allowedRoots.0': { $exists: true }, archivedAt: null };
  if (excludeProjectId) filter._id = { $ne: excludeProjectId };
  const others = await Project.find(filter, { name: 1, organizationId: 1, workspace: 1 }).lean();
  const conflicts = findWorkspaceConflicts(roots, others);
  if (conflicts.length) {
    const named = conflicts.map((c) => (c.organizationId === String(organizationId) ? `"${c.projectName}"` : 'a project in another organization'));
    throw new WorkspaceError(`workspace root is already used by ${[...new Set(named)].join(', ')} — each project needs its own folder`, 409, { conflicts: conflicts.length });
  }
}

// WORKSPACE_BASE gives every new project its own folder automatically.
export function defaultRootFor({ clientName, projectName }) {
  return defaultWorkspaceRoot({ base: process.env.WORKSPACE_BASE, clientName, projectName });
}

export function ensureFolders(roots) {
  for (const r of roots) fs.mkdirSync(r, { recursive: true });
}

// Used when the caller opted out of folder creation: the folder must already
// be there (and be a real directory, not a symlink that could point elsewhere).
export function assertFoldersExist(roots) {
  const bad = roots.filter((r) => { try { const st = fs.lstatSync(r); return !st.isDirectory() || st.isSymbolicLink(); } catch { return true; } });
  if (bad.length) throw new WorkspaceError(`${bad.length} workspace folder(s) do not exist or are not plain directories. Create them, or allow DATYLUNE to create them.`, 422);
}

export async function workerSummary(now = Date.now()) {
  return workerStatus(await WorkerHeartbeat.find({}).lean(), now);
}

// Pre-flight checks run before any work is dispatched to a project. Blocking
// failures stop execution. A missing worker blocks too, unless a human
// explicitly chose "Queue anyway" (the task then waits and may go STALLED).
export async function preflight({ organizationId, project, canViewWorkspace = false, queueAnyway = false }) {
  const roots = project.workspace?.allowedRoots || [];
  const checks = [];
  const add = (id, label, status, detail, blocking = status === 'fail') => checks.push({ id, label, status, detail, blocking });

  const client = project.clientId ? await Client.findOne({ _id: project.clientId, organizationId }).lean() : null;
  add('client', 'Linked to a client', client ? 'pass' : 'warn', client ? client.name : 'This project has no client; assign one so its work and cost are attributable.', false);
  if (project.archivedAt) add('archived', 'Project is active', 'fail', 'This project is archived.');

  if (!roots.length) {
    add('workspace', 'Authorized workspace configured', 'fail', 'No workspace folder is set — agents would have nowhere to work. Set one on the project.');
  } else {
    add('workspace', 'Authorized workspace configured', 'pass', canViewWorkspace ? roots.join(', ') : `${roots.length} folder(s)`);
    try {
      await assertIsolatedRoots({ organizationId, roots, excludeProjectId: project._id });
      add('isolation', 'Workspace isolated from other projects', 'pass', 'No other project can resolve this folder.');
    } catch (err) {
      add('isolation', 'Workspace isolated from other projects', 'fail', err.message);
    }
    const missing = roots.filter((r) => !fs.existsSync(r));
    add('folder', 'Workspace folder exists', missing.length ? 'fail' : 'pass', missing.length ? `${missing.length} folder(s) do not exist on the execution machine.` : 'Present on the execution machine.');
  }

  const worker = await workerSummary();
  const online = worker.status === 'ONLINE';
  add('worker', 'Execution worker online', online ? 'pass' : queueAnyway ? 'warn' : 'fail',
    online ? `${worker.online} worker(s), ${worker.activeJobs}/${worker.capacity} slots busy`
      : queueAnyway ? 'No worker is online. Queued anyway at your request: the task waits and is marked STALLED if no worker starts.'
        : 'No execution worker is online. Start it with `npm run dev`, or confirm "Queue anyway".');
  checks.at(-1).overridable = !online;

  const blocking = checks.filter((c) => c.blocking);
  // A missing worker is the only failure a human may override ("Queue anyway").
  const code = !blocking.length ? null : blocking.every((c) => c.id === 'worker') ? 'WORKER_OFFLINE' : 'PREFLIGHT_FAILED';
  return { ok: !blocking.length, code, checks, worker };
}
