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
  const plan = buildPlan(resolved.map(({ agent, version }) => ({ slug: agent.slug, watches: version.watches, produces: version.produces })), LIMITS);
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
      await appendEvent({ organizationId, taskId, agentRunId: run._id, kind: 'agent_started', data: { slug, stage: stageIdx, tools } });
      const handle = runner({
        prompt: brief(task, version, results),
        appendSystemPrompt: version.instructions,
        allowedTools: tools,
        permissionMode: 'default',
        maxTurns: version.limits?.maxTurns,
        maxBudgetUsd: version.limits?.maxCostUsd || task.budget?.maxCostUsd,
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
  await setCriterion({ organizationId, taskId, criterionId: 'AC-1', status: allOk ? 'PASSED' : 'FAILED', evidence: results.map((r) => `${r.slug}:${r.ok ? 'ok' : 'failed'}`).join(', ') });
  if (!allOk) return transitionTask({ organizationId, taskId, to: 'FAILED', error: 'one or more agent runs failed' });

  task = await Task.findById(taskId);
  if (completionBlockers(task).length === 0) return transitionTask({ organizationId, taskId, to: 'COMPLETED' });
  // Remaining criteria need a human reviewer (not the task creator).
  await requestApproval({ organizationId, taskId, action: 'task.accept', target: String(taskId), payload: { results }, requestedBy: String(task.createdBy) });
  return transitionTask({ organizationId, taskId, to: 'AWAITING_APPROVAL' });
}
