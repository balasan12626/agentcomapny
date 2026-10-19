'use client';
import { useEffect, useState } from 'react';
import { useOrgApi } from '@/lib/useApi';
import { api } from '@/lib/api';
import { Data } from '@/components/States';

export default function Monitoring() {
  const [health, setHealth] = useState({ loading: true });
  useEffect(() => { api('/health').then((data) => setHealth({ data })).catch((error) => setHealth({ error })); }, []);
  const tasks = useOrgApi('/tasks?limit=200');
  const t = tasks.data || [];
  const failed = t.filter((x) => x.status === 'FAILED').length;
  const tokens = t.reduce((a, x) => a + (x.usage?.inputTokens || 0) + (x.usage?.outputTokens || 0), 0);
  return (
    <>
      <h1>Monitoring</h1>
      <p className="sub">API/DB health and per-task token consumption from recorded usage (last 200 tasks).</p>
      <div className="grid">
        <div className="card"><h3>API</h3><div className="stat">{health.loading ? '…' : health.error ? 'down' : 'up'}</div></div>
        <div className="card"><h3>Database</h3><div className="stat">{health.data ? (health.data.db ? 'connected' : 'disconnected') : '…'}</div></div>
        <div className="card"><h3>Failure rate</h3><div className="stat">{t.length ? `${Math.round((failed / t.length) * 100)}%` : '—'}</div></div>
        <div className="card"><h3>Avg tokens / task</h3><div className="stat">{t.length ? Math.round(tokens / t.length).toLocaleString() : '—'}</div></div>
      </div>
      <h2 style={{ fontSize: 15, marginTop: 20 }}>Token consumption by task</h2>
      <Data q={tasks} empty="No tasks yet.">
        {(list) => <table><thead><tr><th>Task</th><th>Input</th><th>Output</th><th>Cache read</th><th>Cost (USD)</th></tr></thead>
          <tbody>{list.map((x) => <tr key={x._id}><td>{x.instruction.slice(0, 60)}</td><td>{(x.usage?.inputTokens || 0).toLocaleString()}</td><td>{(x.usage?.outputTokens || 0).toLocaleString()}</td><td>{(x.usage?.cacheReadTokens || 0).toLocaleString()}</td><td>{(x.usage?.costUsd || 0).toFixed(4)}</td></tr>)}</tbody></table>}
      </Data>
      <p className="sub" style={{ marginTop: 16 }}>Queue latency, worker heartbeat and alerting: checklist G-03 (not built).</p>
    </>
  );
}
