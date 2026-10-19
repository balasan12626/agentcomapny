import fs from 'node:fs';
import { Agent, AgentVersion, AgentRun, Approval, Project, Task } from '../models/index.js';
import { buildPlan } from '../core/roleGraph.js';
import { createPathGuard } from '../core/pathGuard.js';
import { resolveTools } from '../core/toolPolicy.js';
import { completionBlockers } from '../core/taskStateMachine.js';
import { redactPaths, redactPathsDeep } from '../core/redact.js';
import { runClaude } from '../adapters/claudeCode.js';
import { appendEvent } from './events.js';
import { transitionTask, setCriterion, recordUsage, closeOpenRuns } from './tasks.js';
import { requestApproval } from './approvals.js';
import { loadProjectSkillInstructions } from './projectSkills.js';
import { assertIsolatedRoots } from './workspaces.js';
import { audit } from './audit.js';

export const LIMITS = {
  maxParallel: Number(process.env.MAX_PARALLEL_AGENTS || 3),
  maxDepth: Number(process.env.MAX_DELEGATION_DEPTH || 6),
};

// Mode bounds use wall-clock timeouts (always enforced by the adapter).
// `--max-turns` is only passed when an agent version sets it explicitly,
// because it is not listed in `claude --help` for 2.1.x (checklist A-04).
const MODE_TIMEOUT_MS = { QUICK: 5 * 60_000, STANDARD: 20 * 60_000, DEEP: 60 * 60_000, PARALLEL: 20 * 60_000, SCHEDULED: 20 * 60_000 };

async function resolveAgents(task) {
  const out = [];
  for (const ref of task.agents) {
    const agent = await Agent.findOne({ slug: ref.slug, enabled: true, $or: [{ organizationId: task.organizationId }, { organizationId: null }] });
    if (!agent) throw new Error(`agent not available: ${ref.slug}`);
    const version = await AgentVersion.findOne({ agentId: agent._id, version: ref.version || agent.publishedVersion, status: 'PUBLISHED' });
    if (!version) throw new Error(`no published version for ${ref.slug}`);
    out.push({ agent, version });
  }
  return out;
}

// Short, structured brief per agent: objective, constraints, acceptance.
// Keeps context small instead of passing the whole conversation around.
function brief(task, version, upstream) {
  // Workflow steps carry their own complete prompt and JSON output contract.
  if (task.kind === 'workflow') return task.instruction;
  return [
    `Objective: ${task.instruction}`,
    upstream.length ? `Upstream results:\n${upstream.map((u) => `- ${u.slug}: ${u.summary}`).join('\n')}` : '',
    `Acceptance criteria:\n${task.acceptanceCriteria.map((c) => `- ${c.id}: ${c.description}`).join('\n')}`,
    'Report: what changed, files, checks run with evidence, risks, remaining issues.',
  ].filter(Boolean).join('\n\n');
}

const short = (id) => String(id || '').slice(-6);
const excerpt = (s, n = 160) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// Evaluate each acceptance criterion against what was actually recorded:
// a role's criterion is judged on that role's run; named AUTOMATED checks are
// computed from run timestamps and approval records. Anything else (generic
// AUTOMATED / HUMAN) stays PENDING for a validator or reviewer.
export function evaluateCriteria({ criteria, results, edges, approvals }) {
  const bySlug = new Map(results.map((r) => [r.slug, r]));
  const allOk = results.length > 0 && results.every((r) => r.ok);
  const out = [];
  for (const c of criteria) {
    if (c.verification === 'AGENT_RUN') {
      if (c.role) {
        const r = bySlug.get(c.role);
        const ok = !!r?.ok && !!String(r.summary || '').trim();
        out.push({ id: c.id, status: ok ? 'PASSED' : 'FAILED', evidence: r ? `${c.role} run ${short(r.runId)}${r.sessionId ? ` · session ${String(r.sessionId).slice(0, 8)}` : ''} · ${r.ok ? 'finished' : 'failed'}: "${excerpt(r.summary)}"` : `${c.role} did not run` });
      } else {
        out.push({ id: c.id, status: allOk ? 'PASSED' : 'FAILED', evidence: results.map((r) => `${r.slug} run ${short(r.runId)} ${r.ok ? 'finished' : 'failed'}`).join('; ') || 'no runs' });
      }
    } else if (c.verification === 'AUTOMATED' && c.check === 'dependency_order') {
      const bad = (edges || []).filter((e) => { const a = bySlug.get(e.from); const b = bySlug.get(e.to); return !a || !b || !(a.finishedAt <= b.startedAt); });
      out.push({ id: c.id, status: bad.length ? 'FAILED' : 'PASSED', evidence: bad.length ? `order not satisfied: ${bad.map((e) => `${e.from} → ${e.to}`).join(', ')}` : `${(edges || []).length} dependency edge(s) verified from run start/finish times` });
    } else if (c.verification === 'AUTOMATED' && c.check === 'approvals') {
      const open = (approvals || []).filter((a) => ['PENDING', 'REJECTED', 'EXPIRED', 'INVALIDATED'].includes(a.status));
      out.push({ id: c.id, status: open.length ? 'FAILED' : 'PASSED', evidence: (approvals || []).length ? `${approvals.length} approval(s) recorded; ${open.length} not granted` : 'no approval-gated operation was requested during this task' });
    }
  }
  return out;
}

export async function executeTask({ organizationId, taskId, signal, runner = runClaude }) {
  let task = await transitionTask({ organizationId, taskId, to: 'PLANNING' });
  const project = await Project.findOne({ _id: task.projectId, organizationId });
  if (!project?.workspace?.allowedRoots?.length) {
    return transitionTask({ organizationId, taskId, to: 'NEEDS_INPUT', error: 'project has no authorized workspace' });
  }
  const roots = project.workspace.allowedRoots;
  // Re-check isolation and the folder right before execution, not only at
  // submission: another project may have been pointed at the same folder since.
  try {
    await assertIsolatedRoots({ organizationId, roots, excludeProjectId: project._id });
  } catch (err) {
    return transitionTask({ organizationId, taskId, to: 'NEEDS_INPUT', error: err.message });
  }
  if (!fs.existsSync(roots[0])) return transitionTask({ organizationId, taskId, to: 'NEEDS_INPUT', error: 'workspace folder does not exist on the execution machine' });
  const cwd = createPathGuard({ allowedRoots: roots, deniedPatterns: project.workspace.deniedPatterns?.length ? project.workspace.deniedPatterns : undefined })(roots[0]);
  const scrub = (v) => redactPathsDeep(v, roots);
  const cancelled = () => !!signal?.aborted;

  const resolved = await resolveAgents(task);
  const projectSkillInstructions = await loadProjectSkillInstructions(organizationId, task.projectSkills || []);
  // Prefer a plan the caller already persisted (the CEO router computes
  // dependency-ordered stages from the request). Only derive one from the
  // agents' MetaGPT-style watches/produces when no plan was supplied — the
  // catalogue roles declare prose watches, which the artifact graph can't
  // satisfy, so re-deriving there would wrongly fail planning.
  const plan = task.plan?.stages?.length
    // Deep-plain the persisted plan: task.plan is a Mongoose subdocument whose
    // arrays/subdocs carry circular parent refs, which overflow the stack when
    // serialized into events. Map to plain arrays/objects before reuse.
    ? {
      stages: task.plan.stages.map((s) => [...s]),
      edges: (task.plan.edges || []).map((e) => ({ from: e.from, to: e.to, artifact: e.artifact })),
    }
    : buildPlan(resolved.map(({ agent, version }) => ({ slug: agent.slug, watches: version.watches, produces: version.produces })), LIMITS);
  await Task.updateOne({ _id: taskId, organizationId }, { $set: { plan } });
  await appendEvent({ organizationId, taskId, kind: 'plan', data: plan });
  task = await transitionTask({ organizationId, taskId, to: 'RUNNING' });

  const bySlug = new Map(resolved.map((r) => [r.agent.slug, r]));
  const results = [];
  let allOk = true;
  for (const [stageIdx, stage] of plan.stages.entries()) {
    if (cancelled()) break;
    const stageResults = await Promise.all(stage.map(async (slug) => {
      const { version } = bySlug.get(slug);
      const { tools, violations } = resolveTools({ agentAllowed: version.allowedTools, agentDenied: version.deniedTools });
      const startedAt = new Date();
      const run = await AgentRun.create({ organizationId, taskId, agentSlug: slug, agentVersion: version.version, stage: stageIdx, status: 'RUNNING', startedAt });
      if (violations.length) {
        await AgentRun.updateOne({ _id: run._id }, { status: 'FAILED', error: violations.join('; '), finishedAt: new Date() });
        return { slug, ok: false, summary: violations.join('; '), runId: run._id, startedAt, finishedAt: new Date() };
      }
      // CFO-allocated share wins; otherwise fall back to the agent's own limit,
      // then the task-wide budget (legacy behaviour for tasks without a CFO split).
      const maxBudgetUsd = task.agents.find((a) => a.slug === slug)?.maxCostUsd || version.limits?.maxCostUsd || task.budget?.maxCostUsd;
      await appendEvent({ organizationId, taskId, agentRunId: run._id, kind: 'agent_started', data: { slug, stage: stageIdx, tools, maxBudgetUsd } });
      const handle = runner({
        prompt: brief(task, version, results),
        appendSystemPrompt: [version.instructions, projectSkillInstructions].filter(Boolean).join('\n\n'),
        allowedTools: tools,
        permissionMode: 'default',
        maxTurns: version.limits?.maxTurns,
        maxBudgetUsd,
        // Continue the agent's own Claude session for per-agent chat threads so
        // follow-up messages keep context. Only meaningful for single-agent chat.
        resumeSessionId: task.kind === 'chat' ? task.resumeSessionId : undefined,
      }, { cwd, signal, timeoutMs: version.limits?.timeoutMs || MODE_TIMEOUT_MS[task.mode] });
      handle.events.on('event', (ev) => { appendEvent({ organizationId, taskId, agentRunId: run._id, kind: `agent_${ev.kind}`, data: scrub(ev) }).catch(() => {}); });
      const res = await handle.done;
      const { violation } = await recordUsage({ organizationId, taskId, agentRunId: run._id, usage: res.usage });
      const summary = redactPaths(res.final?.summary || res.error || 'no result', roots);
      const finishedAt = new Date();
      // A run aborted by cancellation is CANCELLED, never COMPLETED; and a run
      // the cancel route already closed is not overwritten (status filter).
      const status = cancelled() ? 'CANCELLED' : res.ok ? 'COMPLETED' : 'FAILED';
      await AgentRun.updateOne({ _id: run._id, status: 'RUNNING' }, { status, finishedAt, usage: res.usage, claudeSessionId: res.sessionId, summary, error: status === 'COMPLETED' ? undefined : status === 'CANCELLED' ? 'task cancelled' : redactPaths(res.stderr || res.error, roots) });
      return { slug, ok: res.ok && !violation && !cancelled(), summary: violation || summary, runId: run._id, sessionId: res.sessionId, startedAt, finishedAt };
    }));
    results.push(...stageResults);
    if (stageResults.some((r) => !r.ok)) { allOk = false; break; }
  }

  // The task may have been cancelled (or marked STALLED) while agents ran;
  // it is no longer ours to move forward.
  const current = await Task.findById(taskId);
  if (cancelled() || current.status !== 'RUNNING') {
    await closeOpenRuns({ organizationId, taskId, status: 'CANCELLED', error: 'task cancelled' });
    return current;
  }

  task = await transitionTask({ organizationId, taskId, to: 'VALIDATING' });
  const approvals = await Approval.find({ organizationId, taskId }, { status: 1 }).lean();
  for (const v of evaluateCriteria({ criteria: task.acceptanceCriteria || [], results, edges: plan.edges, approvals })) {
    await setCriterion({ organizationId, taskId, criterionId: v.id, status: v.status, evidence: v.evidence });
  }
  if (!allOk) {
    const failed = results.filter((r) => !r.ok).map((r) => r.slug).join(', ');
    const out = await transitionTask({ organizationId, taskId, to: 'FAILED', error: `agent run failed: ${failed}` });
    await audit({ organizationId, actor: { kind: 'system', id: 'orchestrator' }, action: 'task.failed', target: String(taskId), details: { failed } });
    return out;
  }

  task = await Task.findById(taskId);
  if (completionBlockers(task).length === 0) {
    const out = await transitionTask({ organizationId, taskId, to: 'COMPLETED' });
    await audit({ organizationId, actor: { kind: 'system', id: 'orchestrator' }, action: 'task.completed', target: String(taskId) });
    return out;
  }
  if (task.acceptanceCriteria.some((c) => c.status === 'FAILED')) {
    const failedCriteria = task.acceptanceCriteria.filter((c) => c.status === 'FAILED').map((c) => c.id).join(', ');
    const out = await transitionTask({ organizationId, taskId, to: 'FAILED', error: `acceptance criteria failed: ${failedCriteria}` });
    await audit({ organizationId, actor: { kind: 'system', id: 'orchestrator' }, action: 'task.failed', target: String(taskId), details: { failedCriteria } });
    return out;
  }
  // Remaining criteria need a human reviewer (not the task creator).
  await requestApproval({ organizationId, taskId, action: 'task.accept', target: String(taskId), payload: { results }, requestedBy: String(task.createdBy) });
  return transitionTask({ organizationId, taskId, to: 'AWAITING_APPROVAL' });
}
