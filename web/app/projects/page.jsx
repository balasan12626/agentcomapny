'use client';
import { useState } from 'react';
import { useOrgApi } from '@/lib/useApi';
import { api } from '@/lib/api';
import { Data } from '@/components/States';

export default function Projects() {
  const q = useOrgApi('/projects');
  const [err, setErr] = useState(null);
  async function submit(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try { await api(`/orgs/${q.orgId}/projects`, { method: 'POST', body: { name: f.get('name'), allowedRoots: String(f.get('roots') || '').split('\n').map((s) => s.trim()).filter(Boolean) } }); e.target.reset(); q.reload(); setErr(null); }
    catch (x) { setErr(x.message); }
  }
  return (
    <>
      <h1>Projects & Workspaces</h1>
      <p className="sub">A project's workspace roots bound what agents may touch. The executing device re-checks them against its own local allowlist.</p>
      <form className="card" onSubmit={submit} style={{ marginBottom: 16 }}>
        <label>Name<input name="name" required minLength={2} /></label>
        <label>Authorized workspace roots (one per line)<textarea name="roots" rows={2} placeholder="C:\\work\\client-app" /></label>
        {err && <p role="alert" className="s-err">{err}</p>}
        <button className="btn">Create project</button>
      </form>
      <Data q={q} empty="No projects yet.">
        {(list) => <table><thead><tr><th>Name</th><th>Workspace roots</th></tr></thead><tbody>{list.map((p) => <tr key={p._id}><td>{p.name}</td><td>{(p.workspace?.allowedRoots || []).join(', ') || '—'}</td></tr>)}</tbody></table>}
      </Data>
    </>
  );
}
