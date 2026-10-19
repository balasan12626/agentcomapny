'use client';
import { useOrgApi } from '@/lib/useApi';
import { Data } from '@/components/States';

export default function Audit() {
  const q = useOrgApi('/audit');
  return (
    <>
      <h1>Audit Log</h1>
      <p className="sub">Administrative and sensitive actions, redacted. Requires audit permission.</p>
      <Data q={q} empty="No audit events.">
        {(list) => <table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Request</th></tr></thead>
          <tbody>{list.map((e) => <tr key={e._id}><td>{new Date(e.createdAt).toLocaleString()}</td><td>{e.actor?.kind}:{e.actor?.id?.slice(-6)}</td><td>{e.action}</td><td>{e.target}</td><td><code>{e.requestId?.slice(0, 8)}</code></td></tr>)}</tbody></table>}
      </Data>
    </>
  );
}
