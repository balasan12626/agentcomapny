'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { useOrgApi } from '@/lib/useApi';
import { StatusBadge } from '@/components/StatusBadge';

const fmt = (n) => (n || 0).toLocaleString();
// Every task state is counted somewhere, so the cards always add up to "All tasks".
const STATUS_CARDS = [
  ['Running', ['RUNNING']], ['In progress', ['PLANNING', 'VALIDATING', 'RETRYING']], ['Queued', ['QUEUED']],
  ['Stalled', ['STALLED']], ['Needs input', ['NEEDS_INPUT', 'PAUSED']], ['Awaiting approval', ['AWAITING_APPROVAL']],
  ['Completed', ['COMPLETED']], ['Failed', ['FAILED']], ['Cancelled', ['CANCELLED']],
];
const WORKER = { ONLINE: ['s-ok', 'Online'], OFFLINE: ['s-err', 'Offline'], NEVER_SEEN: ['s-err', 'Never started'] };
const ago = (d) => { const m = Math.round((Date.now() - new Date(d).getTime()) / 60_000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

export default function Dashboard() {
  const overview = useOrgApi('/overview');
  const usage = useOrgApi('/usage');
  const data = overview.data;
  const statuses = data?.tasksByStatus || {};
  const { reload } = overview;
  useEffect(() => {
    const timer = setInterval(() => { reload(); }, 10_000);
    return () => clearInterval(timer);
  }, [reload]);
  const sum = (keys) => keys.reduce((n, k) => n + (statuses[k] || 0), 0);
  const counted = STATUS_CARDS.reduce((n, [, keys]) => n + sum(keys), 0);
  const [workerCls, workerLabel] = WORKER[data?.worker?.status] || ['s-muted', 'Checking'];

  return (
    <>
      <h1>Executive Overview</h1>
      <p className="sub">Live counts come from authorized MongoDB records. No client, project, or agent activity is fabricated.</p>

      {(data?.alerts || []).map((a) => (
        <div key={a.id} role="alert" className={`alert ${a.level === 'error' ? 's-err' : 's-warn'}`}>
          <p>{a.message} {a.id === 'stalled' && <Link href="/tasks?status=STALLED">Review stalled tasks →</Link>}{a.id === 'orphans' && <Link href="/projects">Assign clients →</Link>}{a.id === 'worker' && <Link href="/monitoring">Monitoring →</Link>}</p>
        </div>
      ))}

      {overview.error && <p role="alert" className="s-err">Could not load the organization overview: {overview.error.message}</p>}
      <div className="grid" style={{ margin: '18px 0 8px' }}>
        {[['Clients', data?.clients, '/clients'], ['Projects', data?.projects, '/projects'], ['All tasks', data?.tasks, '/tasks'], ['Agents running', data?.activeAgents.length, '/sessions'], ['Pending approvals', data?.pendingApprovals, '/approvals']].map(([label, value, href]) => (
          <Link className="card" key={label} href={href} style={{ textDecoration: 'none' }}><h3>{label}</h3><div className="stat">{overview.loading && !data ? '…' : fmt(value)}</div></Link>
        ))}
      </div>
      <div className="grid" style={{ margin: '0 0 6px' }}>
        {STATUS_CARDS.map(([label, keys]) => (
          <Link className="card" key={label} href={`/tasks?status=${keys.join(',')}`} style={{ textDecoration: 'none' }}>
            <h3>{label}</h3><div className={`stat ${label === 'Stalled' && sum(keys) ? 's-err' : ''}`}>{overview.loading && !data ? '…' : fmt(sum(keys))}</div>
          </Link>
        ))}
      </div>
      {data && <p className="sub" style={{ marginBottom: 24 }}>Status cards total {fmt(counted)} of {fmt(data.tasks)} tasks.</p>}

      <section className="runtime-strip" aria-labelledby="runtime-heading">
        <div>
          <h2 id="runtime-heading">Claude Code execution</h2>
          <p className="sub">{data?.activeAgents.length ? 'BUSY · persisted Claude Code agent runs are active.' : 'IDLE · no persisted agent run is currently executing.'}</p>
          <p className="sub">Reflects actual AgentRun records and the worker heartbeat, not a persistent interactive terminal.</p>
        </div>
        <div>
          <h3>Execution worker</h3>
          <p className={workerCls}>{workerLabel}</p>
          <p className="sub">{data?.worker?.status === 'ONLINE' ? `${data.worker.activeJobs}/${data.worker.capacity} slots busy` : data?.worker?.lastSeenAt ? `Last heartbeat ${ago(data.worker.lastSeenAt)}` : 'No heartbeat recorded'}</p>
        </div>
        <div>
          <h3>MongoDB</h3>
          <p className={data?.database?.status === 'CONNECTED' ? 's-ok' : 's-err'}>{data?.database?.status || 'Checking'}</p>
          <p className="sub">Connection URI is never shown.</p>
        </div>
        <div>
          <h3>Queue</h3>
          <p className={data?.queue?.oldestQueuedAt ? 's-warn' : 's-ok'}>{data?.queue?.oldestQueuedAt ? `Oldest waiting ${ago(data.queue.oldestQueuedAt)}` : 'Nothing waiting'}</p>
          <p className="sub">Connector &amp; MCP: not configured · <Link href="/integrations">details</Link></p>
        </div>
      </section>

      {data?.stalledTasks?.length > 0 && <>
        <h2 className="section-title">Stalled tasks</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Task</th><th>Project</th><th>Why</th><th>Since</th></tr></thead>
          <tbody>{data.stalledTasks.map((t) => <tr key={t._id}>
            <td><Link href={`/tasks/${t._id}`} className="clip" title={t.instruction}>{t.instruction}</Link></td>
            <td>{t.projectName}</td><td className="sub">{t.reason}</td><td>{t.at ? ago(t.at) : '—'}</td>
          </tr>)}</tbody>
        </table></div>
      </>}

      <h2 className="section-title">Agents working now</h2>
      {overview.loading && !data ? <p className="sub">Loading persisted execution records…</p> : data?.activeAgents.length ? (
        <div className="table-wrap"><table>
          <thead><tr><th>AI agent</th><th>Project</th><th>Assigned work</th><th>Started</th><th>Execution</th></tr></thead>
          <tbody>{data.activeAgents.map((run) => <tr key={`${run.taskId}-${run.agentSlug}`}>
            <td>{run.agentSlug}</td><td>{run.projectName}</td>
            <td><span className="clip" title={run.taskInstruction}>{run.taskInstruction}</span></td>
            <td>{run.startedAt ? new Date(run.startedAt).toLocaleTimeString() : '—'}</td>
            <td><Link href={`/tasks/${run.taskId}`}>Open live task log</Link></td>
          </tr>)}</tbody>
        </table></div>
      ) : <div className="state">No agents are currently executing. Recent work remains available from Tasks.</div>}

      <h2 className="section-title">Recent project work</h2>
      {overview.loading && !data ? <p className="sub">Loading recent tasks…</p> : data?.recentTasks.length ? (
        <div className="table-wrap"><table>
          <thead><tr><th>Task</th><th>Project</th><th>Assigned agents</th><th>Status</th><th>Updated</th></tr></thead>
          <tbody>{data.recentTasks.map((task) => <tr key={task._id}>
            <td><Link href={`/tasks/${task._id}`} className="clip" title={task.instruction}>{task.instruction}</Link></td>
            <td>{task.projectName}</td><td><span className="clip" title={task.agents.map((a) => a.slug).join(', ')}>{task.agents.map((agent) => agent.slug).join(', ') || 'Unassigned'}</span></td>
            <td><StatusBadge status={task.status} /></td><td>{task.updatedAt ? new Date(task.updatedAt).toLocaleString() : '—'}</td>
          </tr>)}</tbody>
        </table></div>
      ) : <div className="state">No tasks have been recorded yet.</div>}

      <h2 className="section-title">Recorded Claude Code usage</h2>
      {usage.error && <p role="alert" className="s-err">Usage records unavailable: {usage.error.message}</p>}
      {usage.data?.records ? <div className="grid">
        <div className="card"><h3>Input tokens</h3><div className="stat">{fmt(usage.data.inputTokens)}</div></div>
        <div className="card"><h3>Output tokens</h3><div className="stat">{fmt(usage.data.outputTokens)}</div></div>
        <div className="card"><h3>Cache read</h3><div className="stat">{fmt(usage.data.cacheReadTokens)}</div></div>
        <div className="card"><h3>Reported cost (USD)</h3><div className="stat">${(usage.data.costUsd || 0).toFixed(4)}</div></div>
      </div> : !usage.loading && <div className="state">No Claude Code usage has been recorded.</div>}
    </>
  );
}
