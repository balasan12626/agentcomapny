'use client';
import { useMemo, useState } from 'react';
import { useOrgApi } from '@/lib/useApi';
import { Data } from '@/components/States';

export default function Agents() {
  const q = useOrgApi('/agents');
  const [filter, setFilter] = useState('');
  const groups = useMemo(() => {
    const out = {};
    for (const a of q.data || []) if (!filter || `${a.name} ${a.department}`.toLowerCase().includes(filter.toLowerCase())) (out[a.department] ||= []).push(a);
    return out;
  }, [q.data, filter]);
  return (
    <>
      <h1>Departments & Agent Catalog</h1>
      <p className="sub">Catalog entries are governed workflow identities executed through Claude Code — not separate models, and not permission grants.</p>
      <label style={{ maxWidth: 320 }}>Search<input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="e.g. security" /></label>
      <Data q={q} empty="Catalog not seeded. Run `npm run seed -w server`.">
        {() => Object.entries(groups).map(([dept, list]) => (
          <section key={dept} style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 15 }}>{dept} <span className="sub">({list.length})</span></h2>
            <div className="grid">{list.map((a) => <div className="card" key={a._id}><h3>{a.type}</h3><strong>{a.name}</strong><div className="sub">{a.slug} · v{a.publishedVersion || '—'} · {a.enabled ? 'enabled' : 'disabled'}</div></div>)}</div>
          </section>
        ))}
      </Data>
    </>
  );
}
