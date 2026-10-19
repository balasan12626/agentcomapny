'use client';
import { use, useEffect, useState } from 'react';
import { useOrgApi } from '@/lib/useApi';
import { useTaskEvents } from '@/lib/useTaskEvents';
import { api } from '@/lib/api';
import { Data } from '@/components/States';
import { StatusBadge } from '@/components/StatusBadge';
import { TaskGraph } from '@/components/TaskGraph';

export default function TaskDetail({ params }) {
  const { taskId } = use(params);
  const q = useOrgApi(`/tasks/${taskId}`);
  const { events, connected } = useTaskEvents(q.orgId, taskId);
  const [selected, setSelected] = useState(null);
  const { reload } = q;
  // Refetch persisted state when a state/usage/agent event arrives.
  const last = events[events.length - 1];
  useEffect(() => { if (last && /state|usage|agent_started|agent_result|plan/.test(last.kind)) reload(); }, [last, reload]);

  return (
    <Data q={q} empty="Task not found.">
      {({ task, runs }) => {
        const run = runs.find((r) => r.agentSlug === selected);
        return (
          <>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div><h1>{task.instruction.slice(0, 90)}</h1><p className="sub">{task.mode} · <StatusBadge status={task.status} /> · live {connected ? 'connected' : 'reconnecting…'}</p></div>
              {!['COMPLETED', 'FAILED', 'CANCELLED'].includes(task.status) && <button className="btn secondary" onClick={() => api(`/orgs/${q.orgId}/tasks/${taskId}/cancel`, { method: 'POST' }).then(reload)}>Cancel</button>}
            </div>
            <div className="grid" style={{ marginBottom: 16 }}>
              <div className="card"><h3>Input tokens</h3><div className="stat">{(task.usage?.inputTokens || 0).toLocaleString()}</div></div>
              <div className="card"><h3>Output tokens</h3><div className="stat">{(task.usage?.outputTokens || 0).toLocaleString()}</div></div>
              <div className="card"><h3>Cache read</h3><div className="stat">{(task.usage?.cacheReadTokens || 0).toLocaleString()}</div></div>
              <div className="card"><h3>Budget</h3><div className="stat">{task.budget?.maxTokens ? task.budget.maxTokens.toLocaleString() : '—'}</div></div>
            </div>
            <div className="split">
              <TaskGraph task={task} runs={runs} onSelect={setSelected} />
              <aside className="card" aria-live="polite">
                {run ? (<>
                  <h3>Agent run</h3><strong>{run.agentSlug} v{run.agentVersion}</strong> <StatusBadge status={run.status} />
                  <p className="sub">Started {run.startedAt ? new Date(run.startedAt).toLocaleTimeString() : '—'} · Claude session {run.claudeSessionId || '—'}</p>
                  <p>Tokens: {((run.usage?.inputTokens || 0) + (run.usage?.outputTokens || 0)).toLocaleString()}</p>
                  {run.error && <p className="s-err">{run.error}</p>}
                  <p style={{ whiteSpace: 'pre-wrap' }}>{run.summary}</p>
                </>) : <p className="sub">Select an agent node to inspect its run.</p>}
                <h3 style={{ marginTop: 16 }}>Acceptance criteria</h3>
                <ul>{task.acceptanceCriteria.map((c) => <li key={c.id}>{c.id} {c.description} <StatusBadge status={c.status === 'PASSED' ? 'COMPLETED' : c.status} />{c.evidence && <div className="sub">{c.evidence}</div>}</li>)}</ul>
              </aside>
            </div>
            <h2 style={{ fontSize: 16 }}>Event timeline</h2>
            <div className="card timeline">{events.length ? events.map((e) => <div key={e.seq}>#{e.seq} {e.kind} {e.data?.status || e.data?.slug || e.data?.text?.slice(0, 120) || ''}</div>) : <span className="sub">No events yet.</span>}</div>
          </>
        );
      }}
    </Data>
  );
}
