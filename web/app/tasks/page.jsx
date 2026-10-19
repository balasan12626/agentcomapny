'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useOrgApi } from '@/lib/useApi';
import { api } from '@/lib/api';
import { Data } from '@/components/States';
import { StatusBadge } from '@/components/StatusBadge';

function NewTask({ orgId, onCreated }) {
  const projects = useOrgApi('/projects');
  const agents = useOrgApi('/agents');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    try {
      const res = await api(`/orgs/${orgId}/tasks`, { method: 'POST', body: {
        projectId: f.get('projectId'), instruction: f.get('instruction'), mode: f.get('mode'),
        agents: f.getAll('agents').map((slug) => ({ slug })),
        idempotencyKey: crypto.randomUUID(),
        budget: f.get('maxTokens') ? { maxTokens: Number(f.get('maxTokens')) } : undefined,
      } });
      e.target.reset(); onCreated(res.task);
    } catch (err) { setError(err.body?.issues?.map((i) => `${i.path}: ${i.message}`).join('; ') || err.message); }
    setBusy(false);
  }
  if (!projects.data?.length) return <div className="state">Create a project with an authorized workspace before submitting tasks.</div>;
  return (
    <form className="card" onSubmit={submit} style={{ marginBottom: 16 }}>
      <div className="row">
        <label style={{ flex: 1 }}>Project<select name="projectId">{projects.data.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select></label>
        <label style={{ flex: 1 }}>Mode<select name="mode" defaultValue="STANDARD">{['QUICK', 'STANDARD', 'DEEP', 'PARALLEL'].map((m) => <option key={m}>{m}</option>)}</select></label>
        <label style={{ flex: 1 }}>Token budget (optional)<input name="maxTokens" type="number" min="1000" step="1000" /></label>
      </div>
      <label>Agents (Ctrl/Cmd-click for several)<select name="agents" multiple required size={6}>{(agents.data || []).map((a) => <option key={a._id} value={a.slug}>{a.department} · {a.name}</option>)}</select></label>
      <label>Instruction<textarea name="instruction" rows={3} required minLength={3} /></label>
      {error && <p role="alert" className="s-err">{error}</p>}
      <button className="btn" disabled={busy}>{busy ? 'Submitting…' : 'Submit task'}</button>
    </form>
  );
}

export default function Tasks() {
  const q = useOrgApi('/tasks');
  return (
    <>
      <h1>Tasks</h1>
      <p className="sub">Submitted tasks run asynchronously through the durable queue and Claude Code.</p>
      {q.orgId && <NewTask orgId={q.orgId} onCreated={q.reload} />}
      <Data q={q} empty="No tasks yet.">
        {(tasks) => (
          <table>
            <thead><tr><th>Task</th><th>Mode</th><th>Status</th><th>Tokens</th><th>Created</th></tr></thead>
            <tbody>{tasks.map((t) => (
              <tr key={t._id}>
                <td><Link href={`/tasks/${t._id}`}>{t.instruction.slice(0, 80)}</Link></td>
                <td>{t.mode}</td><td><StatusBadge status={t.status} /></td>
                <td>{((t.usage?.inputTokens || 0) + (t.usage?.outputTokens || 0)).toLocaleString()}</td>
                <td>{new Date(t.createdAt).toLocaleString()}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Data>
    </>
  );
}
