'use client';
import Link from 'next/link';
import { useOrgApi } from '@/lib/useApi';
import { Data } from '@/components/States';

// Leadership = the one Founder/CEO of the canonical catalogue and the
// department heads it coordinates. Executive agents are read-only
// decision-support identities: they plan, coordinate and report.
export default function Leadership() {
  const q = useOrgApi('/catalog');
  return (
    <>
      <h1>Leadership</h1>
      <p className="sub">Executive agents plan, coordinate and report. They cannot approve their own restricted actions, move money, sign contracts or deploy — role titles grant no permissions.</p>
      <Data q={q} empty="Catalog not seeded. Run `npm run seed:org -w server`.">
        {(data) => (
          <>
            {data.executive && (
              <Link className="card" href={`/agents/${data.executive.slug}`} style={{ display: 'block', textDecoration: 'none', marginBottom: 16, borderLeft: '3px solid var(--accent)' }}>
                <h3>Founder / CEO</h3><strong>{data.executive.name}</strong>
                <div className="sub">{data.executive.slug} · coordinates {data.counts.departmentHeads} department heads</div>
              </Link>
            )}
            <h2 style={{ fontSize: 15 }}>Department heads</h2>
            <div className="grid">
              {data.departments.map((d) => (
                <Link className="card" key={d.slug} href={d.headAgent ? `/agents/${d.headAgent.slug}` : '/catalog'} style={{ textDecoration: 'none' }}>
                  <h3>{d.name}</h3><strong>{d.headAgent?.name || d.head?.title || '—'}</strong>
                  <div className="sub">{d.coreRoleCount} core roles</div>
                </Link>
              ))}
            </div>
          </>
        )}
      </Data>
    </>
  );
}
