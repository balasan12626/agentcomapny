'use client';
import { useState } from 'react';
import { useOrgApi } from '@/lib/useApi';
import { api } from '@/lib/api';
import { Data } from '@/components/States';

export default function Approvals() {
  const q = useOrgApi('/approvals');
  const [msg, setMsg] = useState(null);
  const decide = async (id, decision) => {
    setMsg(null);
    try { await api(`/orgs/${q.orgId}/approvals/${id}/decision`, { method: 'POST', body: { decision } }); q.reload(); }
    catch (e) { setMsg(e.message); }
  };
  return (
    <>
      <h1>Approval Inbox</h1>
      <p className="sub">Approvals are bound to the exact payload hash, expire, are single-use, and cannot be granted by the requester or by any agent.</p>
      {msg && <p role="alert" className="s-err">{msg}</p>}
      <Data q={q} empty="No pending approvals.">
        {(list) => (
          <table>
            <thead><tr><th>Action</th><th>Target</th><th>Payload hash</th><th>Expires</th><th /></tr></thead>
            <tbody>{list.map((a) => (
              <tr key={a._id}>
                <td>{a.action}</td><td>{a.target}</td><td><code>{a.payloadHash.slice(0, 12)}…</code></td>
                <td>{new Date(a.expiresAt).toLocaleString()}</td>
                <td className="row"><button className="btn" onClick={() => decide(a._id, 'APPROVED')}>Approve</button><button className="btn secondary" onClick={() => decide(a._id, 'REJECTED')}>Reject</button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Data>
    </>
  );
}
