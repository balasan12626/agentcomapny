'use client';
import { useOrgApi } from '@/lib/useApi';
import { Data } from '@/components/States';

// Founder/CEO/executive roles are read-only decision-support agents.
export default function Executive() {
  const agents = useOrgApi('/agents');
  return (
    <>
      <h1>Founder & CEO Operations</h1>
      <p className="sub">Executive agents plan, coordinate and report. They cannot approve their own restricted actions, move money, sign contracts or deploy.</p>
      <Data q={agents} empty="Agent catalog not seeded. Run `npm run seed -w server`.">
        {(list) => (
          <div className="grid">
            {list.filter((a) => a.department === 'Executive').map((a) => (
              <div className="card" key={a._id}><h3>{a.type}</h3><strong>{a.name}</strong><p className="sub" style={{ margin: 0 }}>{a.slug} · v{a.publishedVersion || '—'}</p></div>
            ))}
          </div>
        )}
      </Data>
    </>
  );
}
