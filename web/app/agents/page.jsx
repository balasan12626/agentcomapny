'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useOrgApi } from '@/lib/useApi';
import { Data } from '@/components/States';

const KIND = { EXECUTIVE: 'Executive', DEPARTMENT_HEAD: 'Department head', CORE_ROLE: 'Core role', SUBAGENT: 'Sub-agent' };

export default function Agents() {
  const [legacy, setLegacy] = useState(false);
  const q = useOrgApi(legacy ? '/agents?include=legacy' : '/agents');
  const [filter, setFilter] = useState('');
  const [kind, setKind] = useState('');
  const groups = useMemo(() => {
    const out = {};
    const f = filter.toLowerCase();
    for (const a of q.data || []) {
      if (f && !`${a.name} ${a.department} ${a.slug}`.toLowerCase().includes(f)) continue;
      if (kind && (kind === 'LEGACY' ? !a.legacy : a.kind !== kind)) continue;
      (out[a.department] ||= []).push(a);
    }
    return Object.entries(out).sort(([x], [y]) => x.localeCompare(y));
  }, [q.data, filter, kind]);
  const total = groups.reduce((n, [, l]) => n + l.length, 0);
  return (
    <>
      <h1>Agents</h1>
      <p className="sub">The company's canonical workforce — Founder/CEO, department heads, core roles and their sub-agents (the same catalogue as the <Link href="/catalog">Org Chart</Link>). Agents are governed workflow identities executed through Claude Code, not separate models or permission grants.</p>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label style={{ maxWidth: 320, flex: 1 }}>Search<input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="e.g. security" /></label>
        <label style={{ maxWidth: 220 }}>Type
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All types</option>
            {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            {legacy && <option value="LEGACY">Legacy only</option>}
          </select>
        </label>
        <label className="check" style={{ marginBottom: 12 }}><input type="checkbox" checked={legacy} onChange={(e) => setLegacy(e.target.checked)} /> Include legacy (pre-catalogue) agents</label>
      </div>
      <p className="sub">{total} agent(s){legacy ? ' · legacy agents are not offered to the CEO or in task pickers' : ''}</p>
      <Data q={q} empty="Catalog not seeded. Run `npm run seed:org -w server`.">
        {() => groups.map(([dept, list]) => (
          <section key={dept} style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 15 }}>{dept} <span className="sub">({list.length})</span></h2>
            <div className="grid">{list.map((a) => (
              <Link className="card" key={a._id} href={`/agents/${a.slug}`} style={{ textDecoration: 'none' }}>
                <h3>{a.legacy ? 'Legacy' : KIND[a.kind] || a.type}</h3><strong>{a.name}</strong>
                <div className="sub">{a.slug} · v{a.publishedVersion || '—'} · {a.enabled ? 'enabled' : 'disabled'}</div>
              </Link>
            ))}</div>
          </section>
        ))}
      </Data>
    </>
  );
}
