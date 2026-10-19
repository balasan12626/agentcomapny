import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { authenticate, requireOrg, validate, SESSION_COOKIE, issueSession, sessionCookieOptions } from '../middleware.js';
import { PERMISSIONS as P, hasPermission } from '../../core/permissions.js';
import { verifyPassword, verifyToken } from '../../core/session.js';
import { validateSkillMarkdown, reviewSkillBundle } from '../../core/skillValidator.js';
import { User, Membership, Organization, Project, Client, Agent, AgentVersion, Department, Skill, SkillVersion, Task, AgentRun, TaskEvent, Approval, AuditLog, UsageRecord, BugBountyScope, SecurityFinding, RegisteredDevice } from '../../models/index.js';
import { createTask, cancelTask, retryTask } from '../../services/tasks.js';
import { assertIsolatedRoots, assertFoldersExist, defaultRootFor, ensureFolders, preflight, workerSummary } from '../../services/workspaces.js';
import { redactPaths, redactResponse, looksLikePath } from '../../core/redact.js';
import { TERMINAL_STATES, TASK_STATES } from '../../core/taskStateMachine.js';
import { eventsSince } from '../../services/events.js';
import { decide } from '../../services/approvals.js';
import { audit } from '../../services/audit.js';
import { validateScope, canAdvanceFinding } from '../../core/bugBountyScope.js';
import { planFromRequest, planToTask } from '../../core/ceoRouter.js';
import { resolveProjectSkillRefs, resolveSkillsForProject } from '../../services/projectSkills.js';
import { allocateBudget } from '../../core/cfoBudget.js';

const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'invalid id');
const page = (req) => ({ limit: Math.min(Number(req.query.limit) || 50, 200), skip: Math.max(Number(req.query.skip) || 0, 0) });
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Canonical company catalogue identities; anything else is a legacy agent.
const CANONICAL_KINDS = ['EXECUTIVE', 'DEPARTMENT_HEAD', 'CORE_ROLE', 'SUBAGENT'];
const rootsSchema = z.array(z.string().min(1).max(400)).max(10);

export function apiRouter({ enqueue }) {
  const r = Router();

  r.get('/health', (_req, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1 }));

  r.post('/auth/login', validate(z.object({ email: z.string().email(), password: z.string().min(8).max(200) })), async (req, res) => {
    const user = await User.findOne({ email: req.valid.email }).select('+passwordHash');
    if (!user || !verifyPassword(req.valid.password, user.passwordHash)) return res.status(401).json({ error: 'invalid credentials' });
    issueSession(res, user._id);
    await audit({ actor: { kind: 'user', id: String(user._id) }, action: 'auth.login', requestId: req.id });
    res.json({ id: user._id, email: user.email, name: user.name });
  });
  r.post('/auth/logout', (_req, res) => { res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined }); res.json({ ok: true }); });
  // Lets the UI decide between sign-in and the app without a 401 round trip.
  r.get('/auth/session', async (req, res) => {
    const payload = verifyToken(req.cookies?.[SESSION_COOKIE], process.env.SESSION_SECRET);
    const user = payload && await User.exists({ _id: payload.sub });
    res.set('cache-control', 'no-store').json({ authenticated: !!user, expiresAt: user ? new Date(payload.exp) : null });
  });

  r.use(authenticate);
  // One redaction gate for every authenticated response: project roots become
  // <workspace>, any other absolute path keeps only its last segment. Workspace
  // managers keep the full root only on the project setting itself.
  r.use((req, res, next) => {
    const send = res.json.bind(res);
    res.json = (body) => {
      let text;
      try { text = JSON.stringify(body); } catch { return send(body); }
      if (!looksLikePath(text)) return send(body);
      const canSee = req.membership && hasPermission(req.membership.role, P.manageProjects);
      const keep = canSee ? (p) => /(^|\.)workspace\.allowedRoots\.\d+$/.test(p) || /(^|\.)workspacePath$/.test(p) : () => false;
      const finish = (roots) => send(redactResponse(JSON.parse(text), { roots, keep }));
      if (!req.organizationId) return finish([]);
      Project.find({ organizationId: req.organizationId }).select('workspace.allowedRoots').lean()
        .then((ps) => finish(ps.flatMap((p) => p.workspace?.allowedRoots || [])), next);
      return res;
    };
    next();
  });
  r.get('/me', async (req, res) => {
    const memberships = await Membership.find({ userId: req.user._id }).lean();
    const orgs = await Organization.find({ _id: { $in: memberships.map((m) => m.organizationId) } }).lean();
    res.json({ user: { id: req.user._id, email: req.user.email, name: req.user.name }, sessionExpiresAt: req.session?.expiresAt, organizations: orgs.map((o) => ({ ...o, role: memberships.find((m) => String(m.organizationId) === String(o._id)).role })) });
  });

  const o = '/orgs/:orgId';
  const projectView = (project, canViewWorkspace) => {
    const { workspace, ...record } = project;
    return {
      ...record,
      workspace: {
        configured: !!workspace?.allowedRoots?.length,
        ...(canViewWorkspace ? { allowedRoots: workspace?.allowedRoots || [] } : {}),
      },
    };
  };
  r.get(`${o}/projects`, requireOrg(P.read), async (req, res) => {
    const filter = { organizationId: req.organizationId };
    if (req.membership.projectIds?.length) filter._id = { $in: req.membership.projectIds };
    if (req.query.archived !== '1') filter.archivedAt = null;
    const projects = await Project.find(filter).sort({ name: 1 }).lean();
    const clients = await Client.find({ organizationId: req.organizationId, _id: { $in: projects.map((p) => p.clientId).filter(Boolean) } }, { name: 1 }).lean();
    const clientName = new Map(clients.map((c) => [String(c._id), c.name]));
    res.json(projects.map((project) => ({ ...projectView(project, hasPermission(req.membership.role, P.manageProjects)), clientName: clientName.get(String(project.clientId)) || null })));
  });
  // Load a project the caller may run work in (tenant + project scope).
  const workProject = async (req, res, projectId) => {
    const project = await Project.findOne({ _id: projectId, organizationId: req.organizationId });
    if (!project) { res.status(404).json({ error: 'project not found' }); return null; }
    return project;
  };
  // Refuse to dispatch work that cannot run safely (no / shared / missing workspace).
  // `queueAnyway: true` in the body is the human's explicit override for a missing worker only.
  const runPreflight = (req, project) => preflight({ organizationId: req.organizationId, project, canViewWorkspace: hasPermission(req.membership.role, P.manageProjects), queueAnyway: req.body?.queueAnyway === true });
  const preflightError = (pf) => ({ error: `pre-flight failed: ${pf.checks.filter((c) => c.blocking).map((c) => c.detail).join(' ')}`, code: pf.code, preflight: pf });
  const preflightBlocks = async (req, res, project) => {
    const pf = await runPreflight(req, project);
    if (pf.ok) return false;
    res.status(409).json(preflightError(pf));
    return true;
  };
  r.get(`${o}/projects/:projectId/preflight`, requireOrg(P.read), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.projectId)) return res.status(400).json({ error: 'invalid project id' });
    const project = await Project.findOne({ _id: req.params.projectId, organizationId: req.organizationId }).lean();
    if (!project) return res.status(404).json({ error: 'project not found' });
    res.json(await preflight({ organizationId: req.organizationId, project, canViewWorkspace: hasPermission(req.membership.role, P.manageProjects) }));
  });
  r.get(`${o}/projects/:projectId`, requireOrg(P.read), async (req, res) => {
    const project = await Project.findOne({ _id: req.params.projectId, organizationId: req.organizationId }).lean();
    if (!project) return res.status(404).json({ error: 'project not found' });
    const [client, tasks] = await Promise.all([
      project.clientId ? Client.findOne({ _id: project.clientId, organizationId: req.organizationId }).lean() : null,
      Task.find({ organizationId: req.organizationId, projectId: project._id }).sort({ createdAt: -1 }).limit(200).lean(),
    ]);
    res.json({ project: projectView(project, hasPermission(req.membership.role, P.manageProjects)), client, tasks });
  });
  r.put(`${o}/projects/:projectId/skills`, requireOrg(P.manageProjects), validate(z.object({ skillSlugs: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/)).max(5) })), async (req, res) => {
    const project = await Project.findOne({ _id: req.params.projectId, organizationId: req.organizationId });
    if (!project) return res.status(404).json({ error: 'project not found' });
    const refs = await resolveProjectSkillRefs(req.organizationId, req.valid.skillSlugs);
    project.skillSlugs = refs.map((ref) => ref.slug);
    await project.save();
    await audit({ organizationId: req.organizationId, actor: { kind: 'user', id: String(req.user._id) }, action: 'project.skills.update', target: String(project._id), requestId: req.id, details: { skillSlugs: project.skillSlugs } });
    res.json({ projectId: String(project._id), skillSlugs: project.skillSlugs, versions: refs });
  });
  // Every project belongs to a client and gets its own workspace folder: it
  // must not equal, contain or sit inside any other project's folder.
  r.post(`${o}/projects`, requireOrg(P.manageProjects), validate(z.object({ name: z.string().trim().min(2).max(120), allowedRoots: rootsSchema.default([]), clientId: objectId, createFolder: z.boolean().default(true) })), async (req, res) => {
    const client = await Client.findOne({ _id: req.valid.clientId, organizationId: req.organizationId });
    if (!client) return res.status(404).json({ error: 'client not found' });
    if (await Project.exists({ organizationId: req.organizationId, name: req.valid.name })) return res.status(409).json({ error: `a project named "${req.valid.name}" already exists` });
    const fallback = defaultRootFor({ clientName: client.name, projectName: req.valid.name });
    const roots = req.valid.allowedRoots.map((s) => s.trim()).filter(Boolean);
    if (!roots.length && fallback) roots.push(fallback);
    if (roots.length) {
      await assertIsolatedRoots({ organizationId: req.organizationId, roots });
      if (req.valid.createFolder) ensureFolders(roots);
      else assertFoldersExist(roots);
    }
    const p = await Project.create({ organizationId: req.organizationId, name: req.valid.name, clientId: client._id, workspace: { allowedRoots: roots } });
    await audit({ organizationId: req.organizationId, actor: { kind: 'user', id: String(req.user._id) }, action: 'project.create', target: String(p._id), requestId: req.id, details: { clientId: String(client._id), workspaceConfigured: roots.length > 0 } });
    res.status(201).json(p);
  });
  r.patch(`${o}/projects/:projectId`, requireOrg(P.manageProjects), validate(z.object({ name: z.string().trim().min(2).max(120).optional(), clientId: objectId.optional(), allowedRoots: rootsSchema.optional(), createFolder: z.boolean().default(true), archived: z.boolean().optional() })), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.projectId)) return res.status(400).json({ error: 'invalid project id' });
    const project = await Project.findOne({ _id: req.params.projectId, organizationId: req.organizationId });
    if (!project) return res.status(404).json({ error: 'project not found' });
    const before = { name: project.name, clientId: project.clientId ? String(project.clientId) : null, roots: [...(project.workspace?.allowedRoots || [])], archived: !!project.archivedAt };
    if (req.valid.clientId) {
      if (!(await Client.exists({ _id: req.valid.clientId, organizationId: req.organizationId }))) return res.status(404).json({ error: 'client not found' });
      project.clientId = req.valid.clientId;
    }
    if (req.valid.name && req.valid.name !== project.name) {
      if (await Project.exists({ organizationId: req.organizationId, name: req.valid.name, _id: { $ne: project._id } })) return res.status(409).json({ error: `a project named "${req.valid.name}" already exists` });
      project.name = req.valid.name;
    }
    if (req.valid.allowedRoots) {
      const roots = req.valid.allowedRoots.map((s) => s.trim()).filter(Boolean);
      if (roots.length) {
        await assertIsolatedRoots({ organizationId: req.organizationId, roots, excludeProjectId: project._id });
        if (req.valid.createFolder) ensureFolders(roots);
        else assertFoldersExist(roots);
      }
      project.workspace = { ...(project.workspace?.toObject?.() || {}), allowedRoots: roots };
    }
    if (req.valid.archived === false && project.archivedAt && project.workspace?.allowedRoots?.length && !req.valid.allowedRoots) {
      // Archived projects are ignored by isolation checks; restoring one must not resurrect a shared folder.
      await assertIsolatedRoots({ organizationId: req.organizationId, roots: project.workspace.allowedRoots, excludeProjectId: project._id });
    }
    if (req.valid.archived !== undefined) project.archivedAt = req.valid.archived ? new Date() : null;
    await project.save();
    const after = { name: project.name, clientId: project.clientId ? String(project.clientId) : null, roots: [...(project.workspace?.allowedRoots || [])], archived: !!project.archivedAt };
    await audit({ organizationId: req.organizationId, actor: { kind: 'user', id: String(req.user._id) }, action: 'project.update', target: String(project._id), requestId: req.id, details: { before, after } });
    res.json(projectView(project.toObject(), true));
  });

  // Clients: a client owns one or more projects; the CEO/Project Manager then
  // plans and dispatches work per project (see /ceo/execute). This is the
  // client -> project -> PM/CEO -> team chain of a real delivery org.
  r.get(`${o}/clients`, requireOrg(P.read), async (req, res) => {
    const projectFilter = { organizationId: req.organizationId, archivedAt: null };
    if (req.membership.projectIds?.length) projectFilter._id = { $in: req.membership.projectIds };
    const projects = await Project.find(projectFilter).sort({ name: 1 }).lean();
    const clientFilter = { organizationId: req.organizationId };
    if (req.membership.projectIds?.length) {
      clientFilter._id = { $in: [...new Set(projects.map((p) => p.clientId).filter(Boolean).map(String))] };
    }
    const clients = await Client.find(clientFilter).sort({ name: 1 }).lean();
    const byClient = new Map();
    for (const p of projects) { const k = String(p.clientId || ''); (byClient.get(k) || byClient.set(k, []).get(k)).push(p); }
    const canViewWorkspace = hasPermission(req.membership.role, P.manageProjects);
    res.json(clients.map((c) => ({ ...c, projects: (byClient.get(String(c._id)) || []).map((project) => projectView(project, canViewWorkspace)) })));
  });
  r.get(`${o}/clients/:clientId`, requireOrg(P.read), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.clientId)) return res.status(400).json({ error: 'invalid client id' });
    const client = await Client.findOne({ _id: req.params.clientId, organizationId: req.organizationId }).lean();
    if (!client) return res.status(404).json({ error: 'client not found' });
    const projectFilter = { organizationId: req.organizationId, clientId: client._id };
    if (req.membership.projectIds?.length) projectFilter._id = { $in: req.membership.projectIds };
    const projects = await Project.find(projectFilter).sort({ name: 1 }).lean();
    if (req.membership.projectIds?.length && projects.length === 0) return res.status(404).json({ error: 'client not found' });
    const tasks = projects.length
      ? await Task.find({ organizationId: req.organizationId, projectId: { $in: projects.map((p) => p._id) } }).sort({ createdAt: -1 }).limit(200).lean()
      : [];
    res.json({ client, projects: projects.map((project) => projectView(project, hasPermission(req.membership.role, P.manageProjects))), tasks });
  });
  r.put(`${o}/clients/:clientId/skills`, requireOrg(P.manageProjects), validate(z.object({ skillSlugs: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/)).max(5) })), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.clientId)) return res.status(400).json({ error: 'invalid client id' });
    const client = await Client.findOne({ _id: req.params.clientId, organizationId: req.organizationId });
    if (!client) return res.status(404).json({ error: 'client not found' });
    if (req.membership.projectIds?.length) {
      const clientProjectIds = await Project.find({ organizationId: req.organizationId, clientId: client._id }).distinct('_id');
      const visibleIds = new Set(req.membership.projectIds.map(String));
      if (clientProjectIds.some((projectId) => !visibleIds.has(String(projectId)))) return res.status(403).json({ error: 'all client projects must be in scope to manage client defaults' });
    }
    const refs = await resolveProjectSkillRefs(req.organizationId, req.valid.skillSlugs);
    client.skillSlugs = refs.map((ref) => ref.slug);
    await client.save();
    await audit({ organizationId: req.organizationId, actor: { kind: 'user', id: String(req.user._id) }, action: 'client.skills.update', target: String(client._id), requestId: req.id, details: { skillSlugs: client.skillSlugs } });
    res.json({ clientId: String(client._id), skillSlugs: client.skillSlugs, versions: refs });
  });
  r.post(`${o}/clients`, requireOrg(P.manageProjects), validate(z.object({ name: z.string().min(2).max(120) })), async (req, res) => {
    const c = await Client.create({ organizationId: req.organizationId, name: req.valid.name });
    await audit({ organizationId: req.organizationId, actor: { kind: 'user', id: String(req.user._id) }, action: 'client.create', target: String(c._id), requestId: req.id });
    res.status(201).json(c);
  });

  r.get(`${o}/overview`, requireOrg(P.read), async (req, res) => {
    const projectFilter = { organizationId: req.organizationId, archivedAt: null };
    const taskFilter = { organizationId: new mongoose.Types.ObjectId(req.organizationId) };
    if (req.membership.projectIds?.length) {
      projectFilter._id = { $in: req.membership.projectIds };
      taskFilter.projectId = { $in: req.membership.projectIds };
    }
    const projects = await Project.find(projectFilter, { _id: 1, name: 1, clientId: 1 }).lean();
    const clientFilter = { organizationId: req.organizationId };
    if (req.membership.projectIds?.length) {
      clientFilter._id = { $in: [...new Set(projects.map((p) => p.clientId).filter(Boolean).map(String))] };
    }
    const visibleTaskIds = await Task.find(taskFilter).distinct('_id');
    const [clients, taskCounts, recentTasks, activeTasks, pendingApprovals, stalledTasks, oldestQueued, worker] = await Promise.all([
      Client.countDocuments(clientFilter),
      Task.aggregate([{ $match: taskFilter }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      Task.find(taskFilter).sort({ updatedAt: -1 }).limit(12).select('instruction mode status projectId updatedAt agents').lean(),
      Task.find({ ...taskFilter, status: 'RUNNING' }).select('_id instruction projectId').lean(),
      Approval.countDocuments({ organizationId: req.organizationId, status: 'PENDING', taskId: { $in: visibleTaskIds } }),
      Task.find({ ...taskFilter, status: 'STALLED' }).sort({ updatedAt: -1 }).limit(20).select('instruction stall projectId updatedAt').lean(),
      Task.findOne({ ...taskFilter, status: 'QUEUED' }).sort({ createdAt: 1 }).select('createdAt').lean(),
      workerSummary(),
    ]);
    const projectNames = new Map(projects.map((p) => [String(p._id), p.name]));
    const alerts = [];
    if (worker.status !== 'ONLINE') alerts.push({ level: 'error', id: 'worker', message: worker.status === 'NEVER_SEEN' ? 'No execution worker has ever reported in. Start it with `npm run dev` (or `npm run worker -w server`).' : 'The execution worker is offline. Queued work will not start until it is running again.' });
    if (stalledTasks.length) alerts.push({ level: 'warn', id: 'stalled', message: `${stalledTasks.length} task(s) are STALLED — no worker moved them forward. Retry or cancel them.` });
    const orphanProjects = projects.filter((p) => !p.clientId).length;
    if (orphanProjects) alerts.push({ level: 'warn', id: 'orphans', message: `${orphanProjects} project(s) are not linked to a client.` });
    const tasksByStatus = Object.fromEntries(taskCounts.map((entry) => [entry._id, entry.count]));
    const activeTaskIds = activeTasks.map((task) => task._id);
    const [runs, registeredDevices] = await Promise.all([
      activeTaskIds.length ? AgentRun.find({ organizationId: req.organizationId, taskId: { $in: activeTaskIds }, status: 'RUNNING' }).sort({ startedAt: 1 }).limit(50).lean() : [],
      RegisteredDevice.countDocuments({ organizationId: req.organizationId, status: 'ACTIVE' }),
    ]);
    const activeTaskById = new Map(activeTasks.map((task) => [String(task._id), task]));
    const projectById = new Map(projects.map((project) => [String(project._id), project]));
    const activeAgents = runs.map((run) => {
      const task = activeTaskById.get(String(run.taskId));
      const project = projectById.get(String(task?.projectId));
      return { agentSlug: run.agentSlug, stage: run.stage, startedAt: run.startedAt, taskId: String(run.taskId), taskInstruction: task?.instruction || '', projectName: project?.name || 'Project' };
    });
    res.json({
      clients,
      projects: projects.length,
      tasks: Object.values(tasksByStatus).reduce((sum, count) => sum + count, 0),
      tasksByStatus,
      database: { status: mongoose.connection.readyState === 1 ? 'CONNECTED' : 'DISCONNECTED' },
      pendingApprovals,
      activeAgents,
      connector: { status: 'NOT_CONFIGURED', registeredDevices },
      worker,
      queue: { oldestQueuedAt: oldestQueued?.createdAt || null },
      stalledTasks: stalledTasks.map((t) => ({ _id: t._id, instruction: t.instruction, reason: t.stall?.reason, from: t.stall?.from, at: t.stall?.at, projectName: projectNames.get(String(t.projectId)) || 'Project' })),
      alerts,
      recentTasks: recentTasks.map((task) => ({ ...task, projectName: projectById.get(String(task.projectId))?.name || 'Archived project' })),
    });
  });

  // The canonical company catalogue (Founder/CEO, heads, core roles,
  // sub-agents) is the only workforce offered by default; pre-catalogue
  // agents are returned only with ?include=legacy and flagged as such.
  r.get(`${o}/agents`, requireOrg(P.read), async (req, res) => {
    const filter = { $or: [{ organizationId: req.organizationId }, { organizationId: null }] };
    if (req.query.include !== 'legacy') filter.kind = { $in: CANONICAL_KINDS };
    const agents = await Agent.find(filter).sort({ department: 1, name: 1 }).lean();
    res.json(agents.map((a) => ({ ...a, legacy: !CANONICAL_KINDS.includes(a.kind) })));
  });
  r.get(`${o}/agents/:slug`, requireOrg(P.read), async (req, res) => {
    const scope = { $or: [{ organizationId: req.organizationId }, { organizationId: null }] };
    const agent = await Agent.findOne({ slug: req.params.slug, ...scope }).lean();
    if (!agent) return res.status(404).json({ error: 'agent not found' });
    const taskFilter = { organizationId: req.organizationId };
    if (req.membership.projectIds?.length) taskFilter.projectId = { $in: req.membership.projectIds };
    const taskIds = await Task.find(taskFilter).distinct('_id');
    const [version, related, runStats, lastRun] = await Promise.all([
      agent.publishedVersion ? AgentVersion.findOne({ agentId: agent._id, version: agent.publishedVersion }).lean() : null,
      Agent.find({ ...scope, slug: { $in: [agent.parentSlug, agent.headSlug, ...(agent.subAgentSlugs || []), ...(agent.coordinates || [])].filter(Boolean) } }, { slug: 1, name: 1, kind: 1 }).lean(),
      AgentRun.aggregate([{ $match: { organizationId: new mongoose.Types.ObjectId(req.organizationId), agentSlug: agent.slug, taskId: { $in: taskIds } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      AgentRun.findOne({ organizationId: req.organizationId, agentSlug: agent.slug, taskId: { $in: taskIds } }).sort({ startedAt: -1 }).select('taskId status startedAt').lean(),
    ]);
    const bySlug = new Map(related.map((a) => [a.slug, a]));
    res.json({
      agent: { ...agent, legacy: !CANONICAL_KINDS.includes(agent.kind) },
      version: version && { version: version.version, status: version.status, instructions: version.instructions, allowedTools: version.allowedTools, deniedTools: version.deniedTools, skills: version.skills, produces: version.produces, watches: version.watches, limits: version.limits, hash: version.hash, publishedAt: version.createdAt },
      parent: bySlug.get(agent.parentSlug) || null,
      head: bySlug.get(agent.headSlug) || null,
      subAgents: (agent.subAgentSlugs || []).map((s) => bySlug.get(s)).filter(Boolean),
      coordinates: (agent.coordinates || []).map((s) => bySlug.get(s)).filter(Boolean),
      runs: { byStatus: Object.fromEntries(runStats.map((s) => [s._id, s.n])), total: runStats.reduce((n, s) => n + s.n, 0), last: lastRun },
    });
  });
  r.get(`${o}/agents/:slug/versions`, requireOrg(P.read), async (req, res) => {
    const agent = await Agent.findOne({ slug: req.params.slug, $or: [{ organizationId: req.organizationId }, { organizationId: null }] }).lean();
    if (!agent) return res.status(404).json({ error: 'agent not found' });
    res.json(await AgentVersion.find({ agentId: agent._id }).sort({ version: -1 }).lean());
  });

  // Per-agent chat: talk to ONE specialist directly. Each message is a real
  // single-agent run through the same governed pipeline (tenant scope, workspace
  // path guard, usage recording) — the agent answers only within its specialty,
  // enforced by its own system prompt + scoped tools. conversationId groups the
  // thread; the agent's Claude session is resumed so follow-ups keep context.
  r.get(`${o}/agents/:slug/chat`, requireOrg(P.read), async (req, res) => {
    const conversationId = String(req.query.conversationId || '');
    if (!conversationId) return res.json([]);
    const tasks = await Task.find({ organizationId: req.organizationId, conversationId, kind: 'chat' }).sort({ createdAt: 1 }).limit(100).lean();
    const runs = await AgentRun.find({ organizationId: req.organizationId, taskId: { $in: tasks.map((t) => t._id) } }).lean();
    const runByTask = new Map(runs.map((r) => [String(r.taskId), r]));
    const projects = await Project.find({ organizationId: req.organizationId, _id: { $in: [...new Set(tasks.map((t) => String(t.projectId)))] } }, { workspace: 1 }).lean();
    const rootsOf = new Map(projects.map((p) => [String(p._id), p.workspace?.allowedRoots || []]));
    res.json(tasks.map((t) => {
      const run = runByTask.get(String(t._id));
      const roots = rootsOf.get(String(t.projectId)) || [];
      return { _id: t._id, status: t.status, message: t.instruction, createdAt: t.createdAt, reply: run?.summary ? redactPaths(run.summary, roots) : null, error: redactPaths(t.error || run?.error || null, roots), sessionId: run?.claudeSessionId || null };
    }));
  });
  r.post(`${o}/agents/:slug/chat`, requireOrg(P.execute), validate(z.object({
    message: z.string().min(1).max(20000),
    projectId: objectId,
    conversationId: z.string().min(4).max(160).optional(),
    resumeSessionId: z.string().max(128).optional(),
    queueAnyway: z.boolean().optional(),
  })), async (req, res) => {
    const agent = await Agent.findOne({ slug: req.params.slug, enabled: true, $or: [{ organizationId: req.organizationId }, { organizationId: null }] }).lean();
    if (!agent) return res.status(404).json({ error: 'agent not available' });
    const project = await workProject(req, res, req.valid.projectId);
    if (!project || await preflightBlocks(req, res, project)) return;
    const projectSkills = await resolveSkillsForProject(req.organizationId, project);
    const conversationId = req.valid.conversationId || `chat-${agent.slug}-${req.valid.projectId}`;
    const org = await Organization.findById(req.organizationId).lean();
    const budget = { maxTokens: org?.budgets?.maxTokensPerTask, maxCostUsd: org?.budgets?.maxCostUsdPerTask };
    const { task, created } = await createTask({
      organizationId: req.organizationId, projectId: req.valid.projectId, createdBy: req.user._id,
      idempotencyKey: `chat-${conversationId}-${Date.now()}`, instruction: req.valid.message, mode: 'QUICK',
      agents: [{ slug: agent.slug }], plan: { stages: [[agent.slug]], edges: [] },
      acceptanceCriteria: [{ id: 'ac-1', description: `${agent.name} responds within its specialty with supporting evidence`, verification: 'AGENT_RUN' }],
      projectSkills, kind: 'chat', conversationId, resumeSessionId: req.valid.resumeSessionId, budget,
    });
    if (created) await enqueue({ organizationId: req.organizationId, taskId: task._id });
    await audit({ organizationId: req.organizationId, actor: { kind: 'user', id: String(req.user._id) }, action: 'agent.chat', target: `${agent.slug}:${String(task._id)}`, requestId: req.id });
    res.status(created ? 201 : 200).json({ task, conversationId });
  });

  // Company hierarchy: Founder/CEO -> 10 departments (+heads) -> 50 core roles -> 100 sub-agents.
  r.get(`${o}/catalog`, requireOrg(P.read), async (req, res) => {
    const scope = { $or: [{ organizationId: req.organizationId }, { organizationId: null }] };
    const [depts, agents] = await Promise.all([
      Department.find(scope).sort({ order: 1, name: 1 }).lean(),
      Agent.find({ ...scope, kind: { $in: ['EXECUTIVE', 'DEPARTMENT_HEAD', 'CORE_ROLE', 'SUBAGENT'] } }).sort({ name: 1 }).lean(),
    ]);
    const bySlug = new Map(agents.map((a) => [a.slug, a]));
    const subsByParent = new Map();
    for (const a of agents) if (a.kind === 'SUBAGENT' && a.parentSlug) {
      (subsByParent.get(a.parentSlug) || subsByParent.set(a.parentSlug, []).get(a.parentSlug)).push(a);
    }
    const executive = agents.find((a) => a.kind === 'EXECUTIVE') || null;
    const departments = depts.map((d) => {
      const coreRoles = agents
        .filter((a) => a.kind === 'CORE_ROLE' && a.departmentSlug === d.slug)
        .map((r) => ({ ...r, subAgents: (subsByParent.get(r.slug) || []), subAgentCount: (subsByParent.get(r.slug) || []).length }));
      return { ...d, headAgent: d.head?.slug ? (bySlug.get(d.head.slug) || null) : null, coreRoles, coreRoleCount: coreRoles.length };
    });
    res.json({
      executive,
      departments,
      counts: {
        departments: departments.length,
        departmentHeads: agents.filter((a) => a.kind === 'DEPARTMENT_HEAD').length,
        coreRoles: agents.filter((a) => a.kind === 'CORE_ROLE').length,
        subAgents: agents.filter((a) => a.kind === 'SUBAGENT').length,
      },
    });
  });

  // Dynamic CEO routing: preview the minimal team a request needs (no execution).
  r.post(`${o}/ceo/plan`, requireOrg(P.read), validate(z.object({ request: z.string().min(2).max(20000) })), async (req, res) => {
    const scope = { $or: [{ organizationId: req.organizationId }, { organizationId: null }] };
    const [depts, agents] = await Promise.all([
      Department.find(scope).sort({ order: 1 }).lean(),
      Agent.find({ ...scope, kind: { $in: ['EXECUTIVE', 'CORE_ROLE', 'SUBAGENT'] } }).lean(),
    ]);
    const subsByParent = new Map();
    for (const a of agents) if (a.kind === 'SUBAGENT' && a.parentSlug) (subsByParent.get(a.parentSlug) || subsByParent.set(a.parentSlug, []).get(a.parentSlug)).push({ slug: a.slug, name: a.name });
    const catalog = {
      executive: agents.find((a) => a.kind === 'EXECUTIVE') || { slug: 'founder-ceo' },
      departments: depts.map((d) => ({
        slug: d.slug, name: d.name, head: d.head,
        coreRoles: agents.filter((a) => a.kind === 'CORE_ROLE' && a.departmentSlug === d.slug)
          .map((rr) => ({ slug: rr.slug, name: rr.name, departmentSlug: d.slug, type: rr.type, subAgents: subsByParent.get(rr.slug) || [] })),
      })),
    };
    res.json({ request: req.valid.request, plan: planFromRequest(req.valid.request, catalog) });
  });

  // CEO turns a request into a persisted, dependency-ordered Task. dryRun (the
  // default) returns the plan + would-be Task WITHOUT persisting or executing.
  // execute:true persists a real Task and dispatches it through the durable
  // queue to the Claude Code runtime (requires the execute permission).
  r.post(`${o}/ceo/execute`, requireOrg(P.execute), validate(z.object({
    request: z.string().min(2).max(20000),
    projectId: objectId,
    idempotencyKey: z.string().min(8).max(128),
    mode: z.enum(['QUICK', 'STANDARD', 'DEEP', 'PARALLEL', 'SCHEDULED']).default('STANDARD'),
    execute: z.boolean().default(false),
    budgetUsd: z.number().positive().max(10000).optional(),
    queueAnyway: z.boolean().optional(),
  })), async (req, res) => {
    const project = await workProject(req, res, req.valid.projectId);
    if (!project) return;
    const pf = await runPreflight(req, project);
    const projectSkills = await resolveSkillsForProject(req.organizationId, project);
    const org = await Organization.findById(req.organizationId).lean();
    const scope = { $or: [{ organizationId: req.organizationId }, { organizationId: null }] };
    const [depts, agents] = await Promise.all([
      Department.find(scope).sort({ order: 1 }).lean(),
      Agent.find({ ...scope, kind: { $in: ['EXECUTIVE', 'CORE_ROLE', 'SUBAGENT'] } }).lean(),
    ]);
    const subsByParent = new Map();
    for (const a of agents) if (a.kind === 'SUBAGENT' && a.parentSlug) (subsByParent.get(a.parentSlug) || subsByParent.set(a.parentSlug, []).get(a.parentSlug)).push({ slug: a.slug, name: a.name });
    const catalog = {
      executive: agents.find((a) => a.kind === 'EXECUTIVE') || { slug: 'founder-ceo' },
      departments: depts.map((d) => ({
        slug: d.slug, name: d.name, head: d.head,
        coreRoles: agents.filter((a) => a.kind === 'CORE_ROLE' && a.departmentSlug === d.slug)
          .map((rr) => ({ slug: rr.slug, name: rr.name, departmentSlug: d.slug, type: rr.type, subAgents: subsByParent.get(rr.slug) || [] })),
      })),
    };
    const plan = planFromRequest(req.valid.request, catalog);
    const taskShape = planToTask(plan);
    if (plan.coreRoles.length === 0) {
      return res.json({
        dryRun: true,
        requiresClarification: true,
        plan,
        preflight: pf,
        task: { instruction: req.valid.request, mode: req.valid.mode, ...taskShape },
      });
    }

    // CFO step: split the budget (explicit, else the org's per-task default)
    // across the selected roles; each share becomes that agent's hard cap.
    const totalUsd = req.valid.budgetUsd ?? org?.budgets?.maxCostUsdPerTask;
    let cfo = null;
    if (totalUsd) {
      try {
        const budgetRoles = [...plan.coreRoles, ...taskShape.managementAgents.filter((agent) => !plan.coreRoles.some((role) => role.slug === agent.slug))];
        cfo = allocateBudget(budgetRoles, totalUsd);
      }
      catch (err) { return res.status(422).json({ error: `CFO could not allocate: ${err.message}`, plan }); }
      const share = new Map(cfo.allocations.map((a) => [a.slug, a.maxCostUsd]));
      taskShape.agents = taskShape.agents.map((a) => ({ ...a, maxCostUsd: share.get(a.slug) }));
    }

    if (!req.valid.execute) {
      return res.json({ dryRun: true, plan, cfo, projectSkills, preflight: pf, task: { instruction: req.valid.request, mode: req.valid.mode, ...taskShape } });
    }
    // Executing into the selected project only; never into a project that
    // has no, a shared, or a missing workspace.
    if (!pf.ok) return res.status(409).json({ ...preflightError(pf), plan });
    const budget = { maxTokens: org?.budgets?.maxTokensPerTask, maxCostUsd: totalUsd };
    const { task, created } = await createTask({
      organizationId: req.organizationId, projectId: req.valid.projectId, createdBy: req.user._id,
      idempotencyKey: req.valid.idempotencyKey, instruction: req.valid.request, mode: req.valid.mode,
      agents: taskShape.agents, acceptanceCriteria: taskShape.acceptanceCriteria, budget,
      plan: taskShape.plan, management: taskShape.management, projectSkills,
    });
    if (created) await enqueue({ organizationId: req.organizationId, taskId: task._id });
    await audit({ organizationId: req.organizationId, actor: { kind: 'user', id: String(req.user._id) }, action: 'ceo.execute', target: String(task._id), requestId: req.id, details: { projectId: String(project._id), created, ...(pf.worker.status !== 'ONLINE' ? { queuedWithoutWorker: true } : {}) } });
    res.status(created ? 201 : 200).json({ dryRun: false, created, plan, cfo, task });
  });

  r.get(`${o}/skills`, requireOrg(P.read), async (req, res) => {
    res.json(await Skill.find({ $or: [{ organizationId: req.organizationId }, { organizationId: null }] }).sort({ slug: 1 }).lean());
  });
  r.post(`${o}/skills/validate`, requireOrg(P.manageSkills), validate(z.object({ files: z.array(z.object({ path: z.string().max(300), content: z.string().max(256 * 1024) })).min(1).max(50) })), (req, res) => {
    res.json(reviewSkillBundle(req.valid.files));
  });
  r.post(`${o}/skills`, requireOrg(P.manageSkills), validate(z.object({ content: z.string().max(64 * 1024), rationale: z.string().max(2000).optional(), license: z.string().max(100).optional() })), async (req, res) => {
    const v = validateSkillMarkdown(req.valid.content);
    if (!v.valid) return res.status(422).json(v);
    const skill = await Skill.findOneAndUpdate({ organizationId: req.organizationId, slug: v.meta.name }, { $setOnInsert: { organizationId: req.organizationId, slug: v.meta.name } }, { upsert: true, new: true });
    const last = await SkillVersion.findOne({ skillId: skill._id }).sort({ version: -1 });
    const sv = await SkillVersion.create({ skillId: skill._id, version: (last?.version || 0) + 1, status: 'DRAFT', content: req.valid.content, allowedTools: v.meta.allowedTools, hash: v.meta.hash, createdBy: req.user._id, rationale: req.valid.rationale, source: { origin: 'editor', license: req.valid.license } });
    await audit({ organizationId: req.organizationId, actor: { kind: 'user', id: String(req.user._id) }, action: 'skill.version.create', target: `${skill.slug}@${sv.version}`, requestId: req.id, details: { hash: sv.hash } });
    res.status(201).json({ skill, version: sv, warnings: v.warnings });
  });
  // Publishing requires a reviewer other than the author.
  r.post(`${o}/skills/:slug/versions/:version/approve`, requireOrg(P.approve), async (req, res) => {
    const skill = await Skill.findOne({ organizationId: req.organizationId, slug: req.params.slug });
    const sv = skill && await SkillVersion.findOne({ skillId: skill._id, version: Number(req.params.version) });
    if (!sv) return res.status(404).json({ error: 'skill version not found' });
    if (String(sv.createdBy) === String(req.user._id)) return res.status(403).json({ error: 'author cannot approve own skill version' });
    if (sv.quarantinedFiles?.length) return res.status(409).json({ error: 'quarantined files must be reviewed first' });
    sv.status = 'APPROVED'; sv.reviewedBy = req.user._id; await sv.save();
    skill.activeVersion = sv.version; await skill.save();
    await audit({ organizationId: req.organizationId, actor: { kind: 'user', id: String(req.user._id) }, action: 'skill.version.approve', target: `${skill.slug}@${sv.version}`, requestId: req.id });
    res.json(sv);
  });

  const taskBody = z.object({
    projectId: objectId,
    instruction: z.string().min(3).max(20000),
    mode: z.enum(['QUICK', 'STANDARD', 'DEEP', 'PARALLEL', 'SCHEDULED']).default('STANDARD'),
    agents: z.array(z.object({ slug: z.string().regex(/^[a-z0-9-]{2,64}$/), version: z.number().int().positive().optional() })).min(1).max(10),
    idempotencyKey: z.string().min(8).max(128),
    acceptanceCriteria: z.array(z.object({ id: z.string().max(20), description: z.string().max(500) })).max(20).optional(),
    budget: z.object({ maxTokens: z.number().int().positive().optional(), maxCostUsd: z.number().positive().optional() }).optional(),
    queueAnyway: z.boolean().optional(),
  });
  r.post(`${o}/tasks`, requireOrg(P.execute), validate(taskBody), async (req, res) => {
    const project = await workProject(req, res, req.valid.projectId);
    if (!project || await preflightBlocks(req, res, project)) return;
    const projectSkills = await resolveSkillsForProject(req.organizationId, project);
    const org = await Organization.findById(req.organizationId).lean();
    const budget = { maxTokens: req.valid.budget?.maxTokens || org?.budgets?.maxTokensPerTask, maxCostUsd: req.valid.budget?.maxCostUsd || org?.budgets?.maxCostUsdPerTask };
    const { queueAnyway, ...input } = req.valid;
    const { task, created } = await createTask({ ...input, budget, projectSkills, organizationId: req.organizationId, createdBy: req.user._id });
    if (created) {
      await enqueue({ organizationId: req.organizationId, taskId: task._id });
      await audit({ organizationId: req.organizationId, actor: { kind: 'user', id: String(req.user._id) }, action: 'task.create', target: String(task._id), requestId: req.id, details: { projectId: String(project._id), agents: req.valid.agents.map((a) => a.slug), ...(queueAnyway ? { queueAnyway: true } : {}) } });
    }
    res.status(created ? 201 : 200).json({ task, created });
  });
  // Filters: status (comma list), projectId, q (instruction text), kind.
  // The total is returned in X-Total-Count for pagination.
  r.get(`${o}/tasks`, requireOrg(P.read), async (req, res) => {
    const filter = { organizationId: req.organizationId };
    const statuses = String(req.query.status || '').split(',').filter((s) => TASK_STATES.includes(s));
    if (statuses.length) filter.status = { $in: statuses };
    if (req.query.projectId && mongoose.isValidObjectId(req.query.projectId)) filter.projectId = req.query.projectId;
    if (req.membership.projectIds?.length) {
      const scoped = req.membership.projectIds.map(String);
      filter.projectId = filter.projectId && scoped.includes(String(filter.projectId)) ? filter.projectId : { $in: req.membership.projectIds };
    }
    if (req.query.kind === 'task' || req.query.kind === 'chat') filter.kind = req.query.kind;
    if (req.query.q) filter.instruction = { $regex: escapeRegex(String(req.query.q).slice(0, 100)), $options: 'i' };
    const { limit, skip } = page(req);
    const [tasks, total] = await Promise.all([Task.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Task.countDocuments(filter)]);
    const projects = await Project.find({ organizationId: req.organizationId, _id: { $in: [...new Set(tasks.map((t) => String(t.projectId)))] } }, { name: 1, archivedAt: 1 }).lean();
    const byId = new Map(projects.map((p) => [String(p._id), p]));
    res.set('X-Total-Count', String(total));
    res.json(tasks.map((t) => ({ ...t, projectName: byId.get(String(t.projectId))?.name || 'Project unavailable', projectArchived: !!byId.get(String(t.projectId))?.archivedAt })));
  });
  r.get(`${o}/sessions`, requireOrg(P.read), async (req, res) => {
    const taskFilter = { organizationId: req.organizationId };
    if (req.membership.projectIds?.length) taskFilter.projectId = { $in: req.membership.projectIds };
    const taskIds = await Task.find(taskFilter).distinct('_id');
    if (!taskIds.length) return res.json([]);
    const runs = await AgentRun.find({ organizationId: req.organizationId, taskId: { $in: taskIds } }).sort({ startedAt: -1, createdAt: -1 }).limit(100).lean();
    if (!runs.length) return res.json([]);
    const [tasks, events] = await Promise.all([
      Task.find({ organizationId: req.organizationId, _id: { $in: runs.map((run) => run.taskId) } }).select('instruction status projectId cancelledAt').lean(),
      TaskEvent.find({ organizationId: req.organizationId, agentRunId: { $in: runs.map((run) => run._id) } }).sort({ createdAt: -1 }).limit(300).lean(),
    ]);
    const projectIds = [...new Set(tasks.map((task) => String(task.projectId)))];
    const projects = await Project.find({ organizationId: req.organizationId, _id: { $in: projectIds } }).select('name workspace').lean();
    const taskById = new Map(tasks.map((task) => [String(task._id), task]));
    const projectById = new Map(projects.map((project) => [String(project._id), project]));
    // When a task ended after its run (e.g. cancelled later), say so instead of
    // showing two unexplained statuses side by side.
    const endedTasks = tasks.filter((t) => TERMINAL_STATES.includes(t.status));
    const endEvents = endedTasks.length ? await TaskEvent.find({ organizationId: req.organizationId, taskId: { $in: endedTasks.map((t) => t._id) }, kind: 'state', 'data.status': { $in: TERMINAL_STATES } }).select('taskId data createdAt').lean() : [];
    const endedAt = new Map(endEvents.map((e) => [String(e.taskId), e.createdAt]));
    const rootsFor = (task) => projectById.get(String(task?.projectId))?.workspace?.allowedRoots || [];
    const eventsByRun = new Map();
    for (const event of events) {
      const runId = String(event.agentRunId);
      const roots = rootsFor(taskById.get(String(event.taskId)));
      const details = redactPaths(event.data?.text || event.data?.summary || event.data?.tools?.map((tool) => tool.name).join(', ') || event.data?.subtype || '', roots);
      (eventsByRun.get(runId) || eventsByRun.set(runId, []).get(runId)).push({ kind: event.kind, details, at: event.createdAt });
    }
    res.json(runs.map((run) => {
      const task = taskById.get(String(run.taskId));
      const roots = rootsFor(task);
      const taskEnded = task?.cancelledAt || endedAt.get(String(run.taskId));
      let statusNote = null;
      if (task && TERMINAL_STATES.includes(task.status) && task.status !== run.status) {
        statusNote = run.finishedAt && taskEnded && new Date(run.finishedAt) <= new Date(taskEnded)
          ? `This run ${run.status.toLowerCase()} at ${new Date(run.finishedAt).toISOString()}; the task was ${task.status.toLowerCase()} later.`
          : `The task is ${task.status.toLowerCase()}; this run is recorded as ${run.status.toLowerCase()}.`;
      }
      return {
        id: String(run._id), agentSlug: run.agentSlug, stage: run.stage, status: run.status,
        startedAt: run.startedAt, finishedAt: run.finishedAt, summary: redactPaths(run.summary, roots), error: redactPaths(run.error, roots),
        usage: run.usage, taskId: String(run.taskId), taskStatus: task?.status, taskEndedAt: taskEnded || null, statusNote,
        taskInstruction: task?.instruction || '', projectName: projectById.get(String(task?.projectId))?.name || 'Project',
        events: eventsByRun.get(String(run._id)) || [],
      };
    }));
  });
  const loadTask = async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.taskId)) { res.status(400).json({ error: 'invalid id' }); return null; }
    const task = await Task.findOne({ _id: req.params.taskId, organizationId: req.organizationId }).lean();
    if (!task || (req.membership.projectIds?.length && !req.membership.projectIds.map(String).includes(String(task.projectId)))) { res.status(404).json({ error: 'task not found' }); return null; }
    return task;
  };
  r.get(`${o}/tasks/:taskId`, requireOrg(P.read), async (req, res) => {
    const task = await loadTask(req, res);
    if (!task) return;
    const [runs, project] = await Promise.all([
      AgentRun.find({ organizationId: req.organizationId, taskId: task._id }).sort({ stage: 1, startedAt: 1 }).lean(),
      Project.findOne({ _id: task.projectId, organizationId: req.organizationId }, { name: 1, clientId: 1, workspace: 1 }).lean(),
    ]);
    const client = project?.clientId ? await Client.findOne({ _id: project.clientId, organizationId: req.organizationId }, { name: 1 }).lean() : null;
    const roots = project?.workspace?.allowedRoots || [];
    res.json({
      task: { ...task, error: redactPaths(task.error, roots) },
      runs: runs.map((run) => ({ ...run, summary: redactPaths(run.summary, roots), error: redactPaths(run.error, roots) })),
      project: project ? { _id: project._id, name: project.name } : null,
      client,
    });
  });
  r.get(`${o}/tasks/:taskId/events`, requireOrg(P.read), async (req, res) => {
    const task = await loadTask(req, res);
    if (!task) return;
    res.json(await eventsSince({ organizationId: req.organizationId, taskId: task._id, sinceSeq: Number(req.query.since) || 0 }));
  });
  r.post(`${o}/tasks/:taskId/cancel`, requireOrg(P.execute), async (req, res) => {
    const task = await loadTask(req, res);
    if (!task) return;
    const result = await cancelTask({ organizationId: req.organizationId, taskId: task._id });
    await audit({ organizationId: req.organizationId, actor: { kind: 'user', id: String(req.user._id) }, action: 'task.cancel', target: String(task._id), requestId: req.id, details: { from: task.status, runsCancelled: result.runsCancelled, approvalsInvalidated: result.approvalsInvalidated } });
    res.json(result.task);
  });
  r.post(`${o}/tasks/:taskId/retry`, requireOrg(P.execute), async (req, res) => {
    const task = await loadTask(req, res);
    if (!task) return;
    const project = await workProject(req, res, task.projectId);
    if (!project || await preflightBlocks(req, res, project)) return;
    const updated = await retryTask({ organizationId: req.organizationId, taskId: task._id });
    await enqueue({ organizationId: req.organizationId, taskId: task._id });
    await audit({ organizationId: req.organizationId, actor: { kind: 'user', id: String(req.user._id) }, action: 'task.retry', target: String(task._id), requestId: req.id, details: { from: task.status, attempt: updated.attempts } });
    res.json(updated);
  });

  r.get(`${o}/approvals`, requireOrg(P.read), async (req, res) => {
    res.json(await Approval.find({ organizationId: req.organizationId, status: req.query.status || 'PENDING' }).sort({ createdAt: -1 }).limit(200).lean());
  });
  r.post(`${o}/approvals/:approvalId/decision`, requireOrg(P.approve), validate(z.object({ decision: z.enum(['APPROVED', 'REJECTED']) })), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.approvalId)) return res.status(400).json({ error: 'invalid id' });
    try {
      res.json(await decide({ organizationId: req.organizationId, approvalId: req.params.approvalId, user: req.user, membership: req.membership, decision: req.valid.decision, requestId: req.id }));
    } catch (err) {
      if (err.code && !err.status) err.status = err.code === 'FORBIDDEN' || err.code === 'SELF_APPROVAL' ? 403 : 409;
      throw err;
    }
  });

  r.get(`${o}/usage`, requireOrg(P.read), async (req, res) => {
    const taskFilter = { organizationId: req.organizationId };
    if (req.membership.projectIds?.length) taskFilter.projectId = { $in: req.membership.projectIds };
    const taskIds = await Task.find(taskFilter).distinct('_id');
    if (!taskIds.length) return res.json({ records: 0 });
    const [sum] = await UsageRecord.aggregate([
      { $match: { organizationId: new mongoose.Types.ObjectId(req.organizationId), taskId: { $in: taskIds } } },
      { $group: { _id: null, inputTokens: { $sum: '$usage.inputTokens' }, outputTokens: { $sum: '$usage.outputTokens' }, cacheReadTokens: { $sum: '$usage.cacheReadTokens' }, cacheCreationTokens: { $sum: '$usage.cacheCreationTokens' }, costUsd: { $sum: '$usage.costUsd' }, records: { $sum: 1 } } },
    ]);
    res.json(sum || { records: 0 });
  });
  // Filters: action (prefix, e.g. "task."), actorKind (user|system), target.
  r.get(`${o}/audit`, requireOrg(P.audit), async (req, res) => {
    const { limit, skip } = page(req);
    const filter = { organizationId: req.organizationId };
    if (req.query.action) filter.action = { $regex: `^${escapeRegex(String(req.query.action).slice(0, 60))}` };
    if (req.query.actorKind === 'user' || req.query.actorKind === 'system') filter['actor.kind'] = req.query.actorKind;
    if (req.query.target) filter.target = String(req.query.target).slice(0, 80);
    const [items, total, actions] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AuditLog.countDocuments(filter),
      AuditLog.distinct('action', { organizationId: req.organizationId }),
    ]);
    const userIds = [...new Set(items.filter((e) => e.actor?.kind === 'user' && mongoose.isValidObjectId(e.actor.id)).map((e) => e.actor.id))];
    const users = userIds.length ? await User.find({ _id: { $in: userIds } }, { email: 1, name: 1 }).lean() : [];
    const userName = new Map(users.map((u) => [String(u._id), u.name || u.email]));
    // Resolve task/project targets to readable labels (same organization only).
    const targetIds = [...new Set(items.map((e) => e.target).filter((t) => mongoose.isValidObjectId(t)))];
    const [tTasks, tProjects, tClients] = targetIds.length ? await Promise.all([
      Task.find({ organizationId: req.organizationId, _id: { $in: targetIds } }, { instruction: 1 }).lean(),
      Project.find({ organizationId: req.organizationId, _id: { $in: targetIds } }, { name: 1 }).lean(),
      Client.find({ organizationId: req.organizationId, _id: { $in: targetIds } }, { name: 1 }).lean(),
    ]) : [[], [], []];
    const label = new Map([
      ...tTasks.map((t) => [String(t._id), { type: 'task', label: t.instruction.slice(0, 80) }]),
      ...tProjects.map((p) => [String(p._id), { type: 'project', label: p.name }]),
      ...tClients.map((c) => [String(c._id), { type: 'client', label: c.name }]),
    ]);
    res.json({
      total, limit, skip, actions: actions.sort(),
      items: items.map((e) => ({ ...e, actorName: e.actor?.kind === 'user' ? userName.get(e.actor.id) || 'unknown user' : e.actor?.id || 'system', targetLabel: label.get(e.target) || null })),
    });
  });

  r.get(`${o}/monitoring`, requireOrg(P.read), async (req, res) => {
    const taskFilter = { organizationId: new mongoose.Types.ObjectId(req.organizationId) };
    if (req.membership.projectIds?.length) taskFilter.projectId = { $in: req.membership.projectIds };
    const [worker, byStatus, oldestQueued, stalled, finished, lastRun] = await Promise.all([
      workerSummary(),
      Task.aggregate([{ $match: taskFilter }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      Task.findOne({ ...taskFilter, status: 'QUEUED' }).sort({ createdAt: 1 }).select('createdAt instruction').lean(),
      Task.find({ ...taskFilter, status: 'STALLED' }).sort({ updatedAt: -1 }).limit(50).select('instruction stall updatedAt').lean(),
      // Queue latency: time from creation to the first agent run starting.
      AgentRun.aggregate([
        { $match: { organizationId: taskFilter.organizationId, stage: 0, startedAt: { $ne: null } } },
        { $lookup: { from: 'tasks', localField: 'taskId', foreignField: '_id', as: 't' } },
        { $unwind: '$t' },
        ...(taskFilter.projectId ? [{ $match: { 't.projectId': taskFilter.projectId } }] : []),
        { $group: { _id: '$taskId', wait: { $min: { $subtract: ['$startedAt', '$t.createdAt'] } } } },
        { $sort: { wait: 1 } },
      ]),
      AgentRun.findOne({ organizationId: taskFilter.organizationId, finishedAt: { $ne: null } }).sort({ finishedAt: -1 }).select('finishedAt agentSlug').lean(),
    ]);
    const waits = finished.map((f) => f.wait).filter((w) => w >= 0);
    const median = waits.length ? waits[Math.floor(waits.length / 2)] : null;
    res.json({
      worker,
      tasksByStatus: Object.fromEntries(byStatus.map((s) => [s._id, s.n])),
      queue: { oldestQueuedAt: oldestQueued?.createdAt || null, oldestQueuedInstruction: oldestQueued?.instruction?.slice(0, 80) || null, medianStartLatencyMs: median, samples: waits.length },
      stalled: stalled.map((t) => ({ _id: t._id, instruction: t.instruction, reason: t.stall?.reason, from: t.stall?.from, at: t.stall?.at })),
      lastRun: lastRun ? { finishedAt: lastRun.finishedAt, agentSlug: lastRun.agentSlug } : null,
      // Runs can exist with no heartbeat: they were executed by a worker that
      // has since stopped, or by a build from before heartbeats existed.
      note: lastRun && worker.status !== 'ONLINE' ? `The last agent run finished at ${new Date(lastRun.finishedAt).toISOString()}. That worker is not running now${worker.status === 'NEVER_SEEN' ? ' (it predates worker heartbeats, so it never reported in)' : ''}. Start it with npm run dev.` : null,
    });
  });

  r.get(`${o}/security/scopes`, requireOrg(P.read), async (req, res) => res.json(await BugBountyScope.find({ organizationId: req.organizationId }).lean()));
  const text = z.string().trim().max(2000);
  const list = z.array(z.string().trim().min(1).max(300)).max(200).default([]);
  r.post(`${o}/security/scopes`, requireOrg(P.manageOrg), validate(z.object({
    programName: text.optional(), programOwner: text, authorizedAssets: list, excludedAssets: list, permittedTests: list, excludedTests: list,
    windowStart: z.coerce.date().optional(), windowEnd: z.coerce.date().optional(), rateLimitPerMin: z.number().int().positive().max(100000).optional(),
    dataHandling: text, stopConditions: text, escalationContact: text,
  })), async (req, res) => {
    const v = validateScope(req.valid);
    if (!v.valid) return res.status(422).json(v);
    const s = await BugBountyScope.create({ ...req.valid, organizationId: req.organizationId });
    await audit({ organizationId: req.organizationId, actor: { kind: 'user', id: String(req.user._id) }, action: 'security.scope.create', target: String(s._id), requestId: req.id });
    res.status(201).json(s);
  });
  r.get(`${o}/security/findings`, requireOrg(P.read), async (req, res) => res.json(await SecurityFinding.find({ organizationId: req.organizationId }).sort({ createdAt: -1 }).limit(200).lean()));
  r.post(`${o}/security/findings/:id/status`, requireOrg(P.approve), validate(z.object({ status: z.string() })), async (req, res) => {
    const f = await SecurityFinding.findOne({ _id: req.params.id, organizationId: req.organizationId });
    if (!f) return res.status(404).json({ error: 'finding not found' });
    if (!canAdvanceFinding(f.status, req.valid.status)) return res.status(409).json({ error: `cannot move ${f.status} -> ${req.valid.status}` });
    f.status = req.valid.status; await f.save();
    res.json(f);
  });

  return r;
}
