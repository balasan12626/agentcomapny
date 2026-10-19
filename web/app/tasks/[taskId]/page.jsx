'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrgApi, invalidate } from '@/lib/useApi';
import { useTaskEvents } from '@/lib/useTaskEvents';
import { api, errorText } from '@/lib/api';
import { Data } from '@/components/States';
import { StatusBadge } from '@/components/StatusBadge';
import { TaskGraph } from '@/components/TaskGraph';
import { Markdown } from '@/components/Markdown';
import { QueueAnywayPrompt } from '@/components/Preflight';

const TERMINAL = ['COMPLETED', 'FAILED', 'CANCELLED'];
// Token/usage ticks and tool results are noise in a human timeline.
const NOISY = new Set(['usage', 'agent_tool_result', 'agent_session', 'agent_unknown', 'agent_parse_error']);

function describe(e) {
  if (e.kind === 'state') return `${e.data?.from ? `${e.data.from} → ` : ''}${e.data?.status}${e.data?.error ? ` · ${e.data.error}` : ''}`;
  if (e.kind === 'acceptance') return `${e.data?.criterionId} ${e.data?.status}`;
  if (e.kind === 'agent_started') return `${e.data?.slug} started (stage ${(e.data?.stage ?? 0) + 1})`;
  if (e.kind === 'agent_tool_call') return `tool: ${(e.data?.tools || []).map((t) => t.name).join(', ')}`;
  return e.data?.text?.slice(0, 160) || e.data?.summary?.slice(0, 160) || e.data?.slug || e.data?.status || '';
}

export default function TaskDetail({ params }) {
  const { taskId } = use(params);
  const q = useOrgApi(`/tasks/${taskId}`);
  const { events, connected } = useTaskEvents(q.orgId, taskId);
  const [selected, setSelected] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [refused, setRefused] = useState(null);
  const { reload } = q;
  const last = events[events.length - 1];
  useEffect(() => { if (last && /state|usage|agent_started|agent_result|plan|acceptance/.test(last.kind)) reload(); }, [last, reload]);
  const act = async (verb, body) => {
    setActionError(null); setRefused(null);
    try { await api(`/orgs/${q.orgId}/tasks/${taskId}/${verb}`, { method: 'POST', body }); invalidate('/tasks'); reload(); }
    catch (err) { if (err.body?.code === 'WORKER_OFFLINE') setRefused(err); else setActionError(errorText(err)); }
  };

  return (
    <Data q={q} empty="Task not found.">
      {({ task, runs, project, client }) => {
        const run = runs.find((r) => r.agentSlug === selected) || (runs.length === 1 ? runs[0] : null);
        const shown = showAll ? events : events.filter((e) => !NOISY.has(e.kind));
        return (
          <>
            <p className="sub">{client ? <><Link href={`/clients/${client._id}`}>{client.name}</Link> / </> : null}{project ? <Link href={`/projects/${project._id}`}>{project.name}</Link> : 'Project unavailable'} / Task</p>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h1 title={task.instruction} style={{ overflowWrap: 'anywhere' }}>{task.instruction.length > 140 ? `${task.instruction.slice(0, 139)}…` : task.instruction}</h1>
                <p className="sub">{task.mode} · <StatusBadge status={task.status} /> · live {connected ? 'connected' : 'reconnecting…'}{task.attempts ? ` · attempt ${task.attempts + 1}` : ''}</p>
              </div>
              <div className="row">
                {['STALLED', 'NEEDS_INPUT'].includes(task.status) && <button type="button" className="btn" onClick={() => act('retry')}>Retry</button>}
                {!TERMINAL.includes(task.status) && <button type="button" className="btn secondary" onClick={() => act('cancel')}>Cancel</button>}
              </div>
            </div>
            {task.status === 'STALLED' && <div role="alert" className="alert s-err"><p><strong>Stalled:</strong> {task.stall?.reason || task.error}. Retry re-queues it once a worker is running.</p></div>}
            {task.status === 'NEEDS_INPUT' && <div role="alert" className="alert s-warn"><p><strong>Needs input:</strong> {task.error}. Fix it on the <Link href={`/projects/${task.projectId}`}>project</Link>, then retry.</p></div>}
            {task.status === 'FAILED' && task.error && <div role="alert" className="alert s-err"><p><strong>Failed:</strong> {task.error}</p></div>}
            {actionError && <p role="alert" className="s-err">{actionError}</p>}
            <QueueAnywayPrompt error={refused} onConfirm={() => act('retry', { queueAnyway: true })} onDismiss={() => setRefused(null)} />

            <div className="grid" style={{ marginBottom: 16 }}>
              <div className="card"><h3>Input tokens</h3><div className="stat">{(task.usage?.inputTokens || 0).toLocaleString()}</div></div>
              <div className="card"><h3>Output tokens</h3><div className="stat">{(task.usage?.outputTokens || 0).toLocaleString()}</div></div>
              <div className="card"><h3>Cost (USD)</h3><div className="stat">${(task.usage?.costUsd || 0).toFixed(4)}</div></div>
              <div className="card"><h3>Budget</h3><div className="stat">{task.budget?.maxCostUsd ? `$${task.budget.maxCostUsd}` : task.budget?.maxTokens ? task.budget.maxTokens.toLocaleString() : '—'}</div></div>
            </div>
            <div className="split">
              <TaskGraph task={task} runs={runs} onSelect={setSelected} />
              <aside className="card" aria-live="polite">
                <h3>Acceptance criteria</h3>
                <ul style={{ paddingLeft: 18 }}>{task.acceptanceCriteria.map((c) => <li key={c.id} style={{ marginBottom: 6 }}>
                  <StatusBadge status={c.status === 'PASSED' ? 'COMPLETED' : c.status} /> {c.description}
                  <div className="sub">{c.role ? `verified by ${c.role} run` : c.check ? `automated check: ${c.check.replace('_', ' ')}` : c.verification === 'AGENT_RUN' ? 'verified by agent runs' : c.verification === 'AUTOMATED' ? 'automated check' : c.evidence ? 'recorded evidence' : 'awaiting human review'}{c.evidence ? ` — ${c.evidence}` : ''}</div>
                </li>)}</ul>
              </aside>
            </div>

            <h2 style={{ fontSize: 16, marginTop: 20 }}>Agent reports</h2>
            {runs.length ? <div className="chips" role="tablist" aria-label="Agent runs">
              {runs.map((r) => <button key={r._id} type="button" role="tab" className="chip" aria-selected={run?._id === r._id} aria-pressed={run?._id === r._id} onClick={() => setSelected(r.agentSlug)}>{r.agentSlug} · {r.status.toLowerCase()}</button>)}
            </div> : <p className="sub">No agent has run yet.</p>}
            {run && <section className="card">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{run.agentSlug} v{run.agentVersion}</strong> <StatusBadge status={run.status} />
              </div>
              <p className="sub">Started {run.startedAt ? new Date(run.startedAt).toLocaleString() : '—'}{run.finishedAt ? ` · finished ${new Date(run.finishedAt).toLocaleTimeString()}` : ''} · {((run.usage?.inputTokens || 0) + (run.usage?.outputTokens || 0)).toLocaleString()} tokens · ${(run.usage?.costUsd || 0).toFixed(4)}{run.claudeSessionId ? ` · session ${run.claudeSessionId.slice(0, 8)}` : ''}</p>
              {run.error && <p className="s-err">{run.error}</p>}
              {run.summary ? <Markdown text={run.summary} /> : <p className="sub">No report recorded.</p>}
            </section>}

            <div className="row" style={{ justifyContent: 'space-between', marginTop: 20 }}>
              <h2 style={{ fontSize: 16, margin: 0 }}>Event timeline</h2>
              <label className="check" style={{ fontSize: 13 }}><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show technical events ({events.length - events.filter((e) => !NOISY.has(e.kind)).length} hidden)</label>
            </div>
            <div className="card timeline">{shown.length ? shown.map((e) => <div key={e.seq}><span className="sub">{e.at || e.createdAt ? new Date(e.at || e.createdAt).toLocaleTimeString() : `#${e.seq}`}</span> <strong>{e.kind.replace(/^agent_/, '')}</strong> {describe(e)}</div>) : <span className="sub">No events yet.</span>}</div>
          </>
        );
      }}
    </Data>
  );
}
