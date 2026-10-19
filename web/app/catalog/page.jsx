'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useOrgApi } from '@/lib/useApi';
import { Data } from '@/components/States';

function RoleCard({ role }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <strong>{role.name}</strong>
        <span className="sub" style={{ whiteSpace: 'nowrap' }}>{role.type}</span>
      </div>
      <div className="sub">{role.slug} · v{role.publishedVersion || '—'} · {role.enabled ? 'enabled' : 'disabled'}</div>
      <div className="row" style={{ gap: 8 }}>
        <button onClick={() => setOpen((v) => !v)} style={{ fontSize: 12 }}>
          {open ? '▾' : '▸'} {role.subAgentCount} sub-agents
        </button>
        <Link href={`/agents/${role.slug}/chat`} className="btn secondary" style={{ fontSize: 12, padding: '4px 10px' }}>💬 Chat</Link>
      </div>
      {open && (
        <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
          {role.subAgents.map((s) => (
            <li key={s._id} style={{ marginBottom: 2 }}>
              <Link href={`/agents/${s.slug}/chat`}>{s.name}</Link> <span className="sub">· {s.slug}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Catalog() {
  const q = useOrgApi('/catalog');
  const [active, setActive] = useState(null); // department slug or null = all

  const departments = q.data?.departments || [];
  const shown = useMemo(
    () => (active ? departments.filter((d) => d.slug === active) : departments),
    [departments, active],
  );

  return (
    <>
      <h1>Company Org Catalog</h1>
      <p className="sub">
        Founder/CEO → 10 departments → 50 core roles → 100 specialist sub-agents. Configurable governed
        workflow identities executed through Claude Code — not separate models, and not permission grants.
      </p>

      <Data q={q} empty="Catalog not seeded. Run `npm run seed:org -w server`.">
        {(data) => (
          <>
            {data.executive && (
              <section className="card" style={{ marginBottom: 16, borderLeft: '3px solid var(--accent, #7c5cff)' }}>
                <h3 style={{ margin: 0 }}>👑 {data.executive.name}</h3>
                <div className="sub">{data.executive.slug} · coordinates {data.counts.departments} department heads</div>
                <p className="sub" style={{ margin: '6px 0 0' }}>{data.executive.mission || 'Company-wide coordination and prioritization.'}</p>
              </section>
            )}

            <div style={{ display: 'flex', gap: 24, marginBottom: 12, flexWrap: 'wrap' }}>
              <span className="sub"><strong>{data.counts.departments}</strong> departments</span>
              <span className="sub"><strong>{data.counts.coreRoles}</strong> core roles</span>
              <span className="sub"><strong>{data.counts.subAgents}</strong> sub-agents</span>
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
              <button onClick={() => setActive(null)} aria-current={!active} style={{ fontSize: 12, fontWeight: active ? 400 : 700 }}>All</button>
              {departments.map((d) => (
                <button key={d.slug} onClick={() => setActive(d.slug)} aria-current={active === d.slug}
                  style={{ fontSize: 12, fontWeight: active === d.slug ? 700 : 400 }}>{d.name}</button>
              ))}
            </div>

            {shown.map((d) => (
              <section key={d.slug} style={{ marginBottom: 26 }}>
                <h2 style={{ fontSize: 15, marginBottom: 2 }}>
                  {d.name} <span className="sub">({d.coreRoleCount} roles)</span>
                </h2>
                <div className="sub" style={{ marginBottom: 10 }}>
                  Head: {d.head?.title || '—'} {d.head?.slug ? `· ${d.head.slug}` : ''}
                </div>
                <div className="grid">
                  {d.coreRoles.map((r) => <RoleCard key={r._id} role={r} />)}
                </div>
              </section>
            ))}
          </>
        )}
      </Data>
    </>
  );
}
