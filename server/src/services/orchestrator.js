import { Agent, AgentVersion, AgentRun, Project, Task } from '../models/index.js';
import { buildPlan } from '../core/roleGraph.js';
import { createPathGuard } from '../core/pathGuard.js';
import { resolveTools } from '../core/toolPolicy.js';
import { completionBlockers } from '../core/taskStateMachine.js';
import { runClaude } from '../adapters/claudeCode.js';
import { appendEvent } from './events.js';
import { transitionTask, setCriterion, recordUsage } from './tasks.js';
import { requestApproval } from './approvals.js';

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
  return [
    `Objective: ${task.instruction}`,
    upstream.length ? `Upstream results:\n${upstream.map((u) => `- ${u.slug}: ${u.summary}`).join('\n')}` : '',
    `Acceptance criteria:\n${task.acceptanceCriteria.map((c) => `- ${c.id}: ${c.description}`).join('\n')}`,
    'Report: what changed, files, checks run with evidence, risks, remaining issues.',
  ].filter(Boolean).join('\n\n');
}

export async function executeTask({ organizationId, taskId, signal, runner = runClaude }) {
  let task = await transitionTask({ organizationId, taskId, to: 'PLANNING' });
  const project = await Project.findOne({ _id: task.projectId, organizationId });
  if (!project?.workspace?.allowedRoots?.length) {
    return transitionTask({ organizationId, taskId, to: 'NEEDS_INPUT', error: 'project has no authorized workspace' });
  }
  // Re-check workspace right before execution, not only at submission.
  const cwd = createPathGuard({ allowedRoots: project.workspace.allowedRoots, deniedPatterns: project.workspace.deniedPatterns?.length ? project.workspace.deniedPatterns : undefined })(project.workspace.allowedRoots[0]);

  const resolved = await resolveAgents(task);
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
    const stageResults = await Promise.all(stage.map(async (slug) => {
      const { version } = bySlug.get(slug);
      const { tools, violations } = resolveTools({ agentAllowed: version.allowedTools, agentDenied: version.deniedTools });
      const run = await AgentRun.create({ organizationId, taskId, agentSlug: slug, agentVersion: version.version, stage: stageIdx, status: 'RUNNING', startedAt: new Date() });
      if (violations.length) {
        await AgentRun.updateOne({ _id: run._id }, { status: 'FAILED', error: violations.join('; '), finishedAt: new Date() });
        return { slug, ok: false, summary: violations.join('; ') };
      }
      // CFO-allocated share wins; otherwise fall back to the agent's own limit,
      // then the task-wide budget (legacy behaviour for tasks without a CFO split).
      const maxBudgetUsd = task.agents.find((a) => a.slug === slug)?.maxCostUsd || version.limits?.maxCostUsd || task.budget?.maxCostUsd;
      await appendEvent({ organizationId, taskId, agentRunId: run._id, kind: 'agent_started', data: { slug, stage: stageIdx, tools, maxBudgetUsd } });
      const handle = runner({
        prompt: brief(task, version, results),
        appendSystemPrompt: version.instructions,
        allowedTools: tools,
        permissionMode: 'default',
        maxTurns: version.limits?.maxTurns,
        maxBudgetUsd,
        // Continue the agent's own Claude session for per-agent chat threads so
        // follow-up messages keep context. Only meaningful for single-agent chat.
        resumeSessionId: task.kind === 'chat' ? task.resumeSessionId : undefined,
      }, { cwd, signal, timeoutMs: version.limits?.timeoutMs || MODE_TIMEOUT_MS[task.mode] });
      handle.events.on('event', (ev) => { appendEvent({ organizationId, taskId, agentRunId: run._id, kind: `agent_${ev.kind}`, data: ev }).catch(() => {}); });
      const res = await handle.done;
      const { violation } = await recordUsage({ organizationId, taskId, agentRunId: run._id, usage: res.usage });
      const summary = res.final?.summary || res.error || 'no result';
      await AgentRun.updateOne({ _id: run._id }, { status: res.ok ? 'COMPLETED' : 'FAILED', finishedAt: new Date(), usage: res.usage, claudeSessionId: res.sessionId, summary, error: res.ok ? undefined : (res.stderr || res.error) });
      return { slug, ok: res.ok && !violation, summary: violation || summary };
    }));
    results.push(...stageResults);
    if (stageResults.some((r) => !r.ok)) { allOk = false; break; }
  }

  task = await transitionTask({ organizationId, taskId, to: 'VALIDATING' });
  // Mark the task's actual acceptance criteria by their real ids (CEO plans
  // emit ac-1/ac-2/..., defaults differ) — a hardcoded id silently matched
  // nothing and threw, stranding the task in VALIDATING.
  const evidence = results.map((r) => `${r.slug}:${r.ok ? 'ok' : 'failed'}`).join(', ');
  for (const c of task.acceptanceCriteria || []) {
    await setCriterion({ organizationId, taskId, criterionId: c.id, status: allOk ? 'PASSED' : 'FAILED', evidence });
  }
  if (!allOk) return transitionTask({ organizationId, taskId, to: 'FAILED', error: 'one or more agent runs failed' });

  task = await Task.findById(taskId);
  if (completionBlockers(task).length === 0) return transitionTask({ organizationId, taskId, to: 'COMPLETED' });
  // Remaining criteria need a human reviewer (not the task creator).
  await requestApproval({ organizationId, taskId, action: 'task.accept', target: String(taskId), payload: { results }, requestedBy: String(task.createdBy) });
  return transitionTask({ organizationId, taskId, to: 'AWAITING_APPROVAL' });
}
