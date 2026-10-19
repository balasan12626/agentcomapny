'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { useOrgApi } from '@/lib/useApi';
import { StatusBadge } from '@/components/StatusBadge';
import { Markdown } from '@/components/Markdown';

export default function AgentRuns() {
  const query = useOrgApi('/sessions');
  const sessions = query.data || [];
  const running = sessions.filter((session) => session.status === 'RUNNING');
  const { reload } = query;
  useEffect(() => {
    const timer = setInterval(() => { reload(); }, 10_000);
    return () => clearInterval(timer);
  }, [reload]);

  return (
    <>
      <h1>Agent Runs</h1>
      <p className="sub">Every Claude Code run, with its own status and its task's status, scoped to projects you can access. This is an execution history, not an interactive shell.</p>
      {query.error && <p role="alert" className="s-err">Could not load execution history: {query.error.message}</p>}
      <div className="row" style={{ margin: '14px 0 20px', gap: 20 }}>
        <span><strong>{query.loading && !query.data ? '…' : sessions.length}</strong> recorded runs</span>
        <span><strong>{query.loading && !query.data ? '…' : running.length}</strong> executing now</span>
      </div>

      {query.loading && !query.data ? <p className="sub">Loading persisted runs…</p> : !sessions.length ? (
        <div className="state">No Claude Code agent runs are recorded yet.</div>
      ) : <div className="session-list">
        {sessions.map((session) => (
          <details className="session-row" key={session.id} open={session.status === 'RUNNING'}>
            <summary>
              <span>Run <StatusBadge status={session.status} /></span>
              <span className="sub">Task <StatusBadge status={session.taskStatus} /></span>
              <strong>{session.agentSlug}</strong>
              <span className="clip" style={{ maxWidth: 260 }} title={session.projectName}>{session.projectName}</span>
              <span className="sub">{session.startedAt ? new Date(session.startedAt).toLocaleString() : 'Not started'}</span>
            </summary>
            <div className="session-body">
              {session.statusNote && <p className="alert s-info" role="note"><span style={{ color: 'var(--text)' }}>{session.statusNote}</span></p>}
              <p><strong>Task:</strong> {session.taskInstruction} · <Link href={`/tasks/${session.taskId}`}>Open task graph and timeline</Link></p>
              {session.error && <p role="alert" className="s-err"><strong>Recorded error:</strong> {session.error}</p>}
              {session.usage && <p className="sub">Usage: {((session.usage.inputTokens || 0) + (session.usage.outputTokens || 0)).toLocaleString()} input/output tokens · ${(session.usage.costUsd || 0).toFixed(4)}</p>}
              {session.summary && <><h3>Report</h3><Markdown text={session.summary} /></>}
              <h3>Execution events</h3>
              {session.events.length ? <div className="timeline">
                {session.events.map((event, index) => <div key={`${event.kind}-${event.at}-${index}`}>
                  <span className="sub">{new Date(event.at).toLocaleTimeString()}</span> {event.kind.replace(/^agent_/, '')} {event.details}
                </div>)}
              </div> : <p className="sub">No text or tool-call events were recorded for this run.</p>}
            </div>
          </details>
        ))}
      </div>}
      <p className="sub" style={{ marginTop: 18 }}>Absolute workspace paths and account folders are replaced with &lt;workspace&gt; and ~; credentials and raw CLI output are never shown.</p>
    </>
  );
}
