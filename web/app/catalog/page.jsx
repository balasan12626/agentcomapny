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
        <Link href={`/agents/${role.slug}`}><strong>{role.name}</strong></Link>
        <span className="sub" style={{ whiteSpace: 'nowrap' }}>{role.type}</span>
      </div>
      <div className="sub">{role.slug} · v{role.publishedVersion || '—'} · {role.enabled ? 'enabled' : 'disabled'}</div>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="chip" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? '▾' : '▸'} {role.subAgentCount} sub-agents
        </button>
        <Link href={`/agents/${role.slug}/chat`} className="btn secondary small">Chat</Link>
      </div>
      {open && (
        <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
          {role.subAgents.map((s) => (
            <li key={s._id} style={{ marginBottom: 2 }}>
              <Link href={`/agents/${s.slug}`}>{s.name}</Link> <span className="sub">· <Link href={`/agents/${s.slug}/chat`}>chat</Link></span>
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
      <h1>Org Chart</h1>
      <p className="sub">
        The single company catalogue: Founder/CEO → department heads → departments → core roles → specialist sub-agents (live counts below).
        Governed workflow identities executed through Claude Code — not separate models, and not permission grants.
      </p>

      <Data q={q} empty="Catalog not seeded. Run `npm run seed:org -w server`.">
        {(data) => (
          <>
            {data.executive && (
              <section className="card" style={{ marginBottom: 16, borderLeft: '3px solid var(--accent)' }}>
                <h3 style={{ margin: 0 }}><Link href={`/agents/${data.executive.slug}`}>{data.executive.name}</Link></h3>
                <div className="sub">{data.executive.slug} · coordinates {data.counts.departments} department heads</div>
                <p className="sub" style={{ margin: '6px 0 0' }}>{data.executive.mission || 'Company-wide coordination and prioritization.'}</p>
              </section>
            )}

            <div style={{ display: 'flex', gap: 24, marginBottom: 12, flexWrap: 'wrap' }}>
              <span className="sub"><strong>{data.counts.departments}</strong> departments</span>
              <span className="sub"><strong>{data.counts.departmentHeads}</strong> department heads</span>
              <span className="sub"><strong>{data.counts.coreRoles}</strong> core roles</span>
              <span className="sub"><strong>{data.counts.subAgents}</strong> sub-agents</span>
            </div>

            <div className="chips" role="group" aria-label="Filter by department" style={{ marginBottom: 18 }}>
              <button type="button" className="chip" onClick={() => setActive(null)} aria-pressed={!active}>All</button>
              {departments.map((d) => (
                <button type="button" className="chip" key={d.slug} onClick={() => setActive(d.slug)} aria-pressed={active === d.slug}>{d.name}</button>
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
