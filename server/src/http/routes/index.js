import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { authenticate, requireOrg, validate, SESSION_COOKIE } from '../middleware.js';
import { PERMISSIONS as P } from '../../core/permissions.js';
import { signToken, verifyPassword } from '../../core/session.js';
import { validateSkillMarkdown, reviewSkillBundle } from '../../core/skillValidator.js';
import { User, Membership, Organization, Project, Agent, AgentVersion, Department, Skill, SkillVersion, Task, AgentRun, Approval, AuditLog, UsageRecord, BugBountyScope, SecurityFinding } from '../../models/index.js';
import { createTask, transitionTask } from '../../services/tasks.js';
import { eventsSince } from '../../services/events.js';
import { decide } from '../../services/approvals.js';
import { audit } from '../../services/audit.js';
import { validateScope, canAdvanceFinding } from '../../core/bugBountyScope.js';
import { planFromRequest, planToTask } from '../../core/ceoRouter.js';

const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'invalid id');
const page = (req) => ({ limit: Math.min(Number(req.query.limit) || 50, 200), skip: Math.max(Number(req.query.skip) || 0, 0) });

export function apiRouter({ enqueue }) {
  const r = Router();

  r.get('/health', (_req, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1 }));

  r.post('/auth/login', validate(z.object({ email: z.string().email(), password: z.string().min(8).max(200) })), async (req, res) => {
    const user = await User.findOne({ email: req.valid.email }).select('+passwordHash');
    if (!user || !verifyPassword(req.valid.password, user.passwordHash)) return res.status(401).json({ error: 'invalid credentials' });
    res.cookie(SESSION_COOKIE, signToken({ sub: String(user._id) }, process.env.SESSION_SECRET), { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 3600 * 1000 });
    await audit({ actor: { kind: 'user', id: String(user._id) }, action: 'auth.login', requestId: req.id });
    res.json({ id: user._id, email: user.email, name: user.name });
  });
  r.post('/auth/logout', (_req, res) => { res.clearCookie(SESSION_COOKIE); res.json({ ok: true }); });

  r.use(authenticate);
  r.get('/me', async (req, res) => {
    const memberships = await Membership.find({ userId: req.user._id }).lean();
    const orgs = await Organization.find({ _id: { $in: memberships.map((m) => m.organizationId) } }).lean();
    res.json({ user: { id: req.user._id, email: req.user.email, name: req.user.name }, organizations: orgs.map((o) => ({ ...o, role: memberships.find((m) => String(m.organizationId) === String(o._id)).role })) });
  });

  const o = '/orgs/:orgId';
  r.get(`${o}/projects`, requireOrg(P.read), async (req, res) => {
    const filter = { organizationId: req.organizationId };
    if (req.membership.projectIds?.length) filter._id = { $in: req.membership.projectIds };
    res.json(await Project.find(filter).sort({ name: 1 }).lean());
  });
  r.post(`${o}/projects`, requireOrg(P.manageProjects), validate(z.object({ name: z.string().min(2).max(120), allowedRoots: z.array(z.string().min(1)).max(10).default([]) })), async (req, res) => {
    const p = await Project.create({ organizationId: req.organizationId, name: req.valid.name, workspace: { allowedRoots: req.valid.allowedRoots } });
    await audit({ organizationId: req.organizationId, actor: { kind: 'user', id: String(req.user._id) }, action: 'project.create', target: String(p._id), requestId: req.id });
    res.status(201).json(p);
  });

  r.get(`${o}/agents`, requireOrg(P.read), async (req, res) => {
    const agents = await Agent.find({ $or: [{ organizationId: req.organizationId }, { organizationId: null }] }).sort({ department: 1, name: 1 }).lean();
    res.json(agents);
  });
  r.get(`${o}/agents/:slug/versions`, requireOrg(P.read), async (req, res) => {
    const agent = await Agent.findOne({ slug: req.params.slug, $or: [{ organizationId: req.organizationId }, { organizationId: null }] }).lean();
    if (!agent) return res.status(404).json({ error: 'agent not found' });
    res.json(await AgentVersion.find({ agentId: agent._id }).sort({ version: -1 }).lean());
  });

  // Company hierarchy: Founder/CEO -> 10 departments (+heads) -> 50 core roles -> 100 sub-agents.
  r.get(`${o}/catalog`, requireOrg(P.read), async (req, res) => {
    const scope = { $or: [{ organizationId: req.organizationId }, { organizationId: null }] };
    const [depts, agents] = await Promise.all([
      Department.find(scope).sort({ order: 1, name: 1 }).lean(),
      Agent.find({ ...scope, kind: { $in: ['EXECUTIVE', 'CORE_ROLE', 'SUBAGENT'] } }).sort({ name: 1 }).lean(),
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
  })), async (req, res) => {
    const project = await Project.findOne({ _id: req.valid.projectId, organizationId: req.organizationId });
    if (!project) return res.status(404).json({ error: 'project not found' });
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
    if (plan.coreRoles.length === 0) return res.status(422).json({ error: 'no capability matched; ask the user to clarify', plan });

    if (!req.valid.execute) {
      return res.json({ dryRun: true, plan, task: { instruction: req.valid.request, mode: req.valid.mode, ...taskShape } });
    }
    const org = await Organization.findById(req.organizationId).lean();
    const budget = { maxTokens: org?.budgets?.maxTokensPerTask, maxCostUsd: org?.budgets?.maxCostUsdPerTask };
    const { task, created } = await createTask({
      organizationId: req.organizationId, projectId: req.valid.projectId, createdBy: req.user._id,
      idempotencyKey: req.valid.idempotencyKey, instruction: req.valid.request, mode: req.valid.mode,
      agents: taskShape.agents, acceptanceCriteria: taskShape.acceptanceCriteria, budget,
    });
    if (created) await enqueue({ organizationId: req.organizationId, taskId: task._id });
    await audit({ organizationId: req.organizationId, actor: { kind: 'user', id: String(req.user._id) }, action: 'ceo.execute', target: String(task._id), requestId: req.id });
    res.status(created ? 201 : 200).json({ dryRun: false, created, plan, task });
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
  });
  r.post(`${o}/tasks`, requireOrg(P.execute), validate(taskBody), async (req, res) => {
    const project = await Project.findOne({ _id: req.valid.projectId, organizationId: req.organizationId });
    if (!project) return res.status(404).json({ error: 'project not found' });
    const org = await Organization.findById(req.organizationId).lean();
    const budget = { maxTokens: req.valid.budget?.maxTokens || org?.budgets?.maxTokensPerTask, maxCostUsd: req.valid.budget?.maxCostUsd || org?.budgets?.maxCostUsdPerTask };
    const { task, created } = await createTask({ ...req.valid, budget, organizationId: req.organizationId, createdBy: req.user._id });
    if (created) await enqueue({ organizationId: req.organizationId, taskId: task._id });
    res.status(created ? 201 : 200).json({ task, created });
  });
  r.get(`${o}/tasks`, requireOrg(P.read), async (req, res) => {
    const filter = { organizationId: req.organizationId };
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.projectId && mongoose.isValidObjectId(req.query.projectId)) filter.projectId = req.query.projectId;
    if (req.membership.projectIds?.length) filter.projectId = { $in: req.membership.projectIds };
    const { limit, skip } = page(req);
    res.json(await Task.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean());
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
    const runs = await AgentRun.find({ organizationId: req.organizationId, taskId: task._id }).sort({ stage: 1 }).lean();
    res.json({ task, runs });
  });
  r.get(`${o}/tasks/:taskId/events`, requireOrg(P.read), async (req, res) => {
    const task = await loadTask(req, res);
    if (!task) return;
    res.json(await eventsSince({ organizationId: req.organizationId, taskId: task._id, sinceSeq: Number(req.query.since) || 0 }));
  });
  r.post(`${o}/tasks/:taskId/cancel`, requireOrg(P.execute), async (req, res) => {
    const task = await loadTask(req, res);
    if (!task) return;
    res.json(await transitionTask({ organizationId: req.organizationId, taskId: task._id, to: 'CANCELLED' }));
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
    const [sum] = await UsageRecord.aggregate([
      { $match: { organizationId: new mongoose.Types.ObjectId(req.organizationId) } },
      { $group: { _id: null, inputTokens: { $sum: '$usage.inputTokens' }, outputTokens: { $sum: '$usage.outputTokens' }, cacheReadTokens: { $sum: '$usage.cacheReadTokens' }, cacheCreationTokens: { $sum: '$usage.cacheCreationTokens' }, costUsd: { $sum: '$usage.costUsd' }, records: { $sum: 1 } } },
    ]);
    res.json(sum || { records: 0 });
  });
  r.get(`${o}/audit`, requireOrg(P.audit), async (req, res) => {
    const { limit, skip } = page(req);
    res.json(await AuditLog.find({ organizationId: req.organizationId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean());
  });

  r.get(`${o}/security/scopes`, requireOrg(P.read), async (req, res) => res.json(await BugBountyScope.find({ organizationId: req.organizationId }).lean()));
  r.post(`${o}/security/scopes`, requireOrg(P.manageOrg), async (req, res) => {
    const v = validateScope(req.body);
    if (!v.valid) return res.status(422).json(v);
    const s = await BugBountyScope.create({ ...req.body, organizationId: req.organizationId });
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
