'use client';
import { useOrgApi } from '@/lib/useApi';
import { Data } from '@/components/States';

const fmt = (n) => (n || 0).toLocaleString();

export default function Dashboard() {
  const tasks = useOrgApi('/tasks?limit=200');
  const usage = useOrgApi('/usage');
  const approvals = useOrgApi('/approvals');
  const counts = (tasks.data || []).reduce((a, t) => ({ ...a, [t.status]: (a[t.status] || 0) + 1 }), {});
  return (
    <>
      <h1>Executive Overview</h1>
      <p className="sub">Live figures from recorded tasks, approvals and Claude Code usage. Nothing here is estimated.</p>
      <div className="grid" style={{ marginBottom: 16 }}>
        {['RUNNING', 'QUEUED', 'AWAITING_APPROVAL', 'FAILED', 'COMPLETED'].map((s) => (
          <div className="card" key={s}><h3>{s.replace(/_/g, ' ')}</h3><div className="stat">{tasks.loading ? '…' : fmt(counts[s])}</div></div>
        ))}
        <div className="card"><h3>Pending approvals</h3><div className="stat">{approvals.loading ? '…' : fmt(approvals.data?.length)}</div></div>
      </div>
      <h2 style={{ fontSize: 16 }}>Token consumption (all tasks)</h2>
      <Data q={usage} empty="No Claude Code usage recorded yet.">
        {(u) => u.records ? (
          <div className="grid">
            <div className="card"><h3>Input tokens</h3><div className="stat">{fmt(u.inputTokens)}</div></div>
            <div className="card"><h3>Output tokens</h3><div className="stat">{fmt(u.outputTokens)}</div></div>
            <div className="card"><h3>Cache read tokens</h3><div className="stat">{fmt(u.cacheReadTokens)}</div></div>
            <div className="card"><h3>Reported cost (USD)</h3><div className="stat">{(u.costUsd || 0).toFixed(4)}</div></div>
          </div>
        ) : <div className="state">No Claude Code usage recorded yet.</div>}
      </Data>
    </>
  );
}
