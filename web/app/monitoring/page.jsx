'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrgApi } from '@/lib/useApi';
import { api } from '@/lib/api';
import { Data } from '@/components/States';

const dur = (ms) => (ms == null ? '—' : ms < 60_000 ? `${Math.round(ms / 1000)} s` : ms < 3600_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3600_000).toFixed(1)} h`);
const WORKER = { ONLINE: 's-ok', OFFLINE: 's-err', NEVER_SEEN: 's-err' };

export default function Monitoring() {
  const [health, setHealth] = useState({ loading: true });
  useEffect(() => { api('/health').then((data) => setHealth({ data })).catch((error) => setHealth({ error })); }, []);
  const mon = useOrgApi('/monitoring');
  const tasks = useOrgApi('/tasks?limit=200');
  const { reload } = mon;
  useEffect(() => { const t = setInterval(reload, 15_000); return () => clearInterval(t); }, [reload]);
  const m = mon.data;
  const t = tasks.data || [];
  const finished = t.filter((x) => ['COMPLETED', 'FAILED'].includes(x.status));
  const failed = finished.filter((x) => x.status === 'FAILED').length;
  const tokens = t.reduce((a, x) => a + (x.usage?.inputTokens || 0) + (x.usage?.outputTokens || 0), 0);
  return (
    <>
      <h1>Monitoring</h1>
      <p className="sub">API, database, execution worker heartbeat, queue latency and stalled work.</p>
      {m?.note && <div role="status" className="alert s-warn"><p>{m.note}</p></div>}
      <div className="grid">
        <div className="card"><h3>API</h3><div className="stat">{health.loading ? '…' : health.error ? 'down' : 'up'}</div></div>
        <div className="card"><h3>Database</h3><div className="stat">{health.data ? (health.data.db ? 'connected' : 'disconnected') : '…'}</div></div>
        <div className="card"><h3>Execution worker</h3><div className={`stat ${WORKER[m?.worker?.status] || ''}`}>{m ? m.worker.status.replace('_', ' ').toLowerCase() : '…'}</div><div className="sub">{m?.worker?.lastSeenAt ? `last heartbeat ${new Date(m.worker.lastSeenAt).toLocaleTimeString()}` : 'no heartbeat recorded'}</div>{m?.lastRun && <div className="sub">last agent run finished {new Date(m.lastRun.finishedAt).toLocaleString()}</div>}</div>
        <div className="card"><h3>Oldest queued task</h3><div className="stat">{m?.queue?.oldestQueuedAt ? dur(Date.now() - new Date(m.queue.oldestQueuedAt).getTime()) : 'none'}</div></div>
        <div className="card"><h3>Median start latency</h3><div className="stat">{dur(m?.queue?.medianStartLatencyMs)}</div><div className="sub">{m?.queue?.samples || 0} task(s) sampled</div></div>
        <div className="card"><h3>Stalled tasks</h3><div className={`stat ${m?.stalled?.length ? 's-err' : ''}`}>{m ? m.stalled.length : '…'}</div></div>
        <div className="card"><h3>Failure rate (finished)</h3><div className="stat">{finished.length ? `${Math.round((failed / finished.length) * 100)}%` : '—'}</div></div>
        <div className="card"><h3>Avg tokens / task</h3><div className="stat">{t.length ? Math.round(tokens / t.length).toLocaleString() : '—'}</div></div>
      </div>

      {m?.stalled?.length > 0 && <>
        <h2 className="section-title">Stalled tasks</h2>
        <div className="table-wrap"><table><thead><tr><th>Task</th><th>Stalled from</th><th>Reason</th><th>At</th></tr></thead>
          <tbody>{m.stalled.map((s) => <tr key={s._id}><td><Link href={`/tasks/${s._id}`} className="clip" title={s.instruction}>{s.instruction}</Link></td><td>{s.from}</td><td className="sub">{s.reason}</td><td>{s.at ? new Date(s.at).toLocaleString() : '—'}</td></tr>)}</tbody></table></div>
      </>}

      <h2 className="section-title">Token consumption by task</h2>
      <Data q={tasks} empty="No tasks yet.">
        {(list) => <div className="table-wrap"><table><thead><tr><th>Task</th><th>Input</th><th>Output</th><th>Cache read</th><th>Cost (USD)</th></tr></thead>
          <tbody>{list.map((x) => <tr key={x._id}><td><Link href={`/tasks/${x._id}`} className="clip" title={x.instruction}>{x.instruction}</Link></td><td>{(x.usage?.inputTokens || 0).toLocaleString()}</td><td>{(x.usage?.outputTokens || 0).toLocaleString()}</td><td>{(x.usage?.cacheReadTokens || 0).toLocaleString()}</td><td>{(x.usage?.costUsd || 0).toFixed(4)}</td></tr>)}</tbody></table></div>}
      </Data>
      <p className="sub" style={{ marginTop: 16 }}>A task is marked STALLED when it waits more than 10 min with no worker online (30 min if a worker is online but never picks it up), or a running task makes no progress for 5 min after its worker disappears. External alerting (email/Slack) is not configured.</p>
    </>
  );
}
