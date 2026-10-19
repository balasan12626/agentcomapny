'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useOrgApi, invalidate } from '@/lib/useApi';
import { api, errorText } from '@/lib/api';
import { Data } from '@/components/States';

// Client -> project -> PM/CEO -> team. A client owns projects; each project has
// an authorized workspace; from a project you brief the CEO/Project Manager,
// who picks the smallest sufficient team and dispatches real work. This is the
// "real IT company" delivery chain.

function NewProject({ orgId, clientId, onCreated }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    try {
      const root = f.get('root').trim();
      await api(`/orgs/${orgId}/projects`, { method: 'POST', body: { name: f.get('name'), clientId, allowedRoots: root ? [root] : [] } });
      e.target.reset(); setOpen(false); invalidate('/projects'); onCreated();
    } catch (err) { setError(errorText(err)); }
    setBusy(false);
  }
  if (!open) return <button className="btn secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setOpen(true)}>+ New project</button>;
  return (
    <form className="row" onSubmit={submit} style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
      <input name="name" placeholder="Project name" required minLength={2} style={{ flex: '1 1 160px' }} />
      <input name="root" placeholder="Its own workspace folder (e.g. C:\work\acme\web-app)" style={{ flex: '2 1 260px' }} />
      <button className="btn" disabled={busy}>{busy ? 'Creating…' : 'Create'}</button>
      {error && <p role="alert" className="s-err" style={{ flexBasis: '100%', margin: 0 }}>{error}</p>}
    </form>
  );
}

function NewClient({ orgId, onCreated }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    try { await api(`/orgs/${orgId}/clients`, { method: 'POST', body: { name: f.get('name') } }); e.target.reset(); onCreated(); }
    catch (err) { setError(err.body?.error || err.message); }
    setBusy(false);
  }
  return (
    <form className="card row" onSubmit={submit} style={{ gap: 8, marginBottom: 16, alignItems: 'center' }}>
      <input name="name" placeholder="New client name (e.g. Demo Commerce Client)" required minLength={2} style={{ flex: 1 }} />
      <button className="btn" disabled={busy}>{busy ? 'Adding…' : 'Add client'}</button>
      {error && <p role="alert" className="s-err" style={{ flexBasis: '100%', margin: 0 }}>{error}</p>}
    </form>
  );
}

// Projects created before clients were required: make them visible and let
// a manager attach each to a client in one step.
function Unassigned({ orgId, clients, onChanged }) {
  const projects = useOrgApi('/projects');
  const [error, setError] = useState(null);
  const orphans = (projects.data || []).filter((p) => !p.clientId);
  if (!orphans.length) return null;
  async function assign(projectId, clientId) {
    setError(null);
    try { await api(`/orgs/${orgId}/projects/${projectId}`, { method: 'PATCH', body: { clientId } }); invalidate('/projects'); projects.reload(); onChanged(); }
    catch (err) { setError(errorText(err)); }
  }
  return (
    <section className="card" style={{ marginBottom: 16, borderColor: 'var(--warn)' }}>
      <h3 style={{ margin: 0 }} className="s-warn">{orphans.length} project(s) without a client</h3>
      <p className="sub">Work in these projects is not attributable to anyone. Assign each to a client.</p>
      {error && <p role="alert" className="s-err">{error}</p>}
      <table><tbody>{orphans.map((p) => <tr key={p._id}>
        <td><Link href={`/projects/${p._id}`}>{p.name}</Link></td>
        <td><select aria-label={`Client for ${p.name}`} defaultValue="" onChange={(e) => e.target.value && assign(p._id, e.target.value)}>
          <option value="" disabled>Assign to client…</option>
          {clients.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
        </select></td>
      </tr>)}</tbody></table>
    </section>
  );
}

export default function Clients() {
  const q = useOrgApi('/clients');
  return (
    <>
      <h1>Clients</h1>
      <p className="sub">Each client owns projects. From a project, brief the CEO / Project Manager — they pick the right team and dispatch real work to the specialists.</p>
      {q.orgId && <NewClient orgId={q.orgId} onCreated={q.reload} />}
      {q.orgId && q.data?.length > 0 && <Unassigned orgId={q.orgId} clients={q.data} onChanged={() => { invalidate('/clients'); q.reload(); }} />}
      <Data q={q} empty="No clients yet. Add one above to start the client → project → team flow.">
        {(clients) => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {clients.map((c) => (
              <div className="card" key={c._id}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <h3 style={{ margin: 0 }}><Link href={`/clients/${c._id}`}>{c.name}</Link></h3>
                  <span className="sub">{c.projects.length} project(s)</span>
                </div>
                {c.projects.length > 0 && (
                  <table style={{ marginTop: 8 }}>
                    <thead><tr><th>Project</th><th>Workspace</th><th>Actions</th></tr></thead>
                    <tbody>
                      {c.projects.map((p) => (
                        <tr key={p._id}>
                          <td><Link href={`/projects/${p._id}`}><strong>{p.name}</strong></Link></td>
                          <td className="sub">{p.workspace?.allowedRoots?.[0] || (p.workspace?.configured ? 'workspace path restricted' : <span className="s-err">no workspace — set one to run work</span>)}</td>
                          <td>
                            <Link href={`/ceo?projectId=${p._id}`} className="btn" style={{ fontSize: 12, padding: '4px 10px', marginRight: 6 }}>Brief the CEO / PM →</Link>
                            <Link href={`/clients/${c._id}`} className="btn secondary" style={{ fontSize: 12, padding: '4px 10px' }}>Workspace</Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div style={{ marginTop: 8 }}><NewProject orgId={q.orgId} clientId={c._id} onCreated={q.reload} /></div>
              </div>
            ))}
          </div>
        )}
      </Data>
    </>
  );
}
