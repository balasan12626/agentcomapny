'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useOrgApi } from '@/lib/useApi';
import { Data } from '@/components/States';

const PAGE = 50;
const HREF = { task: (id) => `/tasks/${id}`, project: (id) => `/projects/${id}`, client: (id) => `/clients/${id}` };

export default function Audit() {
  const [action, setAction] = useState('');
  const [actorKind, setActorKind] = useState('');
  const [skip, setSkip] = useState(0);
  const params = useMemo(() => {
    const p = new URLSearchParams({ limit: String(PAGE), skip: String(skip) });
    if (action) p.set('action', action);
    if (actorKind) p.set('actorKind', actorKind);
    return p.toString();
  }, [action, actorKind, skip]);
  const q = useOrgApi(`/audit?${params}`);
  const groups = [...new Set((q.data?.actions || []).map((a) => `${a.split('.')[0]}.`))];
  return (
    <>
      <h1>Audit Log</h1>
      <p className="sub">Every create, execute, cancel, retry, stall, approval and configuration change — redacted. Requires audit permission.</p>
      <div className="row" style={{ marginBottom: 10 }}>
        <label style={{ flex: 1, margin: 0 }}>Action
          <select value={action} onChange={(e) => { setAction(e.target.value); setSkip(0); }}>
            <option value="">All actions</option>
            {groups.map((g) => <option key={g} value={g}>{g}*</option>)}
            {(q.data?.actions || []).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label style={{ flex: 1, margin: 0 }}>Actor
          <select value={actorKind} onChange={(e) => { setActorKind(e.target.value); setSkip(0); }}>
            <option value="">Users and system</option><option value="user">Users</option><option value="system">System</option>
          </select>
        </label>
      </div>
      <Data q={q} empty="No audit events.">
        {({ items, total }) => items.length ? <>
          <div className="table-wrap"><table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Details</th><th>Request</th></tr></thead>
            <tbody>{items.map((e) => <tr key={e._id}>
              <td>{new Date(e.createdAt).toLocaleString()}</td>
              <td>{e.actorName}{e.actor?.kind === 'system' && <span className="sub"> (system)</span>}</td>
              <td><code>{e.action}</code></td>
              <td>{e.targetLabel ? <Link href={HREF[e.targetLabel.type](e.target)} className="clip" title={e.targetLabel.label}>{e.targetLabel.type}: {e.targetLabel.label}</Link> : <span className="sub">{e.target || '—'}</span>}</td>
              <td className="sub"><span className="clip" title={e.details ? JSON.stringify(e.details) : ''}>{e.details ? Object.entries(e.details).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ') : ''}</span></td>
              <td><code title={e.requestId}>{e.requestId?.slice(0, 8)}</code></td>
            </tr>)}</tbody></table></div>
          <div className="row" style={{ marginTop: 10 }}>
            <button type="button" className="btn secondary small" disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - PAGE))}>← Newer</button>
            <span className="sub">{skip + 1}–{skip + items.length} of {total}</span>
            <button type="button" className="btn secondary small" disabled={skip + items.length >= total} onClick={() => setSkip(skip + PAGE)}>Older →</button>
          </div>
        </> : <div className="state">No audit events match these filters.</div>}
      </Data>
    </>
  );
}
