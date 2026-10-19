'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useOrgApi, invalidate } from '@/lib/useApi';
import { api, errorText } from '@/lib/api';
import { Data } from '@/components/States';

const roots = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);

function EditProject({ project, clients, orgId, onDone }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    try {
      const next = roots(f.get('roots'));
      const changed = next.join('\n') !== (project.workspace?.allowedRoots || []).join('\n');
      await api(`/orgs/${orgId}/projects/${project._id}`, { method: 'PATCH', body: { clientId: f.get('clientId') || undefined, ...(changed ? { allowedRoots: next } : {}) } });
      invalidate('/projects'); invalidate('/clients'); onDone();
    } catch (err) { setError(errorText(err)); }
    setBusy(false);
  }
  return (
    <form onSubmit={submit} className="card" style={{ margin: '6px 0' }}>
      <div className="row">
        <label style={{ flex: 1 }}>Client
          <select name="clientId" defaultValue={project.clientId || ''} required>
            <option value="" disabled>Choose a client…</option>
            {clients.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </select>
        </label>
        <label style={{ flex: 2 }}>Workspace folder(s), one per line — must not be shared with any other project
          <textarea name="roots" rows={2} defaultValue={(project.workspace?.allowedRoots || []).join('\n')} />
        </label>
      </div>
      {error && <p role="alert" className="s-err">{error}</p>}
      <div className="row"><button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button><button type="button" className="btn secondary" onClick={onDone}>Cancel</button></div>
    </form>
  );
}

export default function Projects() {
  const [showArchived, setShowArchived] = useState(false);
  const q = useOrgApi(`/projects${showArchived ? '?archived=1' : ''}`);
  const clients = useOrgApi('/clients');
  const [err, setErr] = useState(null);
  const [editing, setEditing] = useState(null);
  const reload = () => { invalidate('/projects'); invalidate('/clients'); q.reload(); clients.reload(); };
  async function submit(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api(`/orgs/${q.orgId}/projects`, { method: 'POST', body: { name: f.get('name'), clientId: f.get('clientId'), allowedRoots: roots(f.get('roots')) } });
      e.target.reset(); setErr(null); reload();
    } catch (x) { setErr(errorText(x)); }
  }
  async function archive(p, archived) {
    try { await api(`/orgs/${q.orgId}/projects/${p._id}`, { method: 'PATCH', body: { archived } }); reload(); } catch (x) { setErr(errorText(x)); }
  }
  const clientList = clients.data || [];
  return (
    <>
      <h1>Projects & Workspaces</h1>
      <p className="sub">Every project belongs to a client and has its own workspace folder. No two projects may share, contain or sit inside each other's folder, and none may point into the DATYLUNE application itself.</p>
      {clients.data && !clientList.length ? <div className="state">Add a client first — every project belongs to one. <Link href="/clients">Clients →</Link></div> : (
        <form className="card" onSubmit={submit} style={{ marginBottom: 16 }}>
          <div className="row">
            <label style={{ flex: 1 }}>Client
              <select name="clientId" required defaultValue="">
                <option value="" disabled>Choose a client…</option>
                {clientList.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
              </select>
            </label>
            <label style={{ flex: 1 }}>Project name<input name="name" required minLength={2} /></label>
          </div>
          <label>Workspace folder (one per line). Leave empty to use the server's per-project default (WORKSPACE_BASE), if configured.<textarea name="roots" rows={2} placeholder="C:\work\acme\web-app" /></label>
          {err && <p role="alert" className="s-err">{err}</p>}
          <button className="btn">Create project</button>
        </form>
      )}
      <label className="check" style={{ marginBottom: 8 }}><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived projects</label>
      <Data q={q} empty="No projects yet.">
        {(list) => <div className="table-wrap"><table>
          <thead><tr><th>Project</th><th>Client</th><th>Workspace</th><th /></tr></thead>
          <tbody>{list.map((p) => <tr key={p._id}>
            <td><Link href={`/projects/${p._id}`}>{p.name}</Link>{p.archivedAt && <span className="badge s-muted" style={{ marginLeft: 6 }}>archived</span>}</td>
            <td>{p.clientName || <span className="s-warn">No client</span>}</td>
            <td>{editing === p._id ? <EditProject project={p} clients={clientList} orgId={q.orgId} onDone={() => { setEditing(null); reload(); }} />
              : <span className="clip" title={p.workspace?.allowedRoots?.join(', ')}>{p.workspace?.allowedRoots?.join(', ') || (p.workspace?.configured ? 'Configured; path restricted' : <span className="s-err">Not configured</span>)}</span>}</td>
            <td className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
              {editing !== p._id && <button type="button" className="btn secondary small" onClick={() => setEditing(p._id)}>Edit</button>}
              <button type="button" className="btn secondary small" onClick={() => archive(p, !p.archivedAt)}>{p.archivedAt ? 'Restore' : 'Archive'}</button>
            </td>
          </tr>)}</tbody>
        </table></div>}
      </Data>
    </>
  );
}
