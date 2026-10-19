'use client';
import { useState } from 'react';
import { useOrg } from '@/lib/org';
import { useOrgApi } from '@/lib/useApi';
import { api, errorText } from '@/lib/api';
import { Data } from '@/components/States';
import { StatusBadge } from '@/components/StatusBadge';

const lines = (v) => String(v || '').split('\n').map((s) => s.trim()).filter(Boolean);

// Scope records are the written authorization that unlocks active testing.
function NewScope({ orgId, onCreated }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    try {
      await api(`/orgs/${orgId}/security/scopes`, { method: 'POST', body: {
        programName: f.get('programName'), programOwner: f.get('programOwner'),
        authorizedAssets: lines(f.get('authorizedAssets')), excludedAssets: lines(f.get('excludedAssets')),
        permittedTests: lines(f.get('permittedTests')), excludedTests: lines(f.get('excludedTests')),
        windowStart: f.get('windowStart') || undefined, windowEnd: f.get('windowEnd') || undefined,
        rateLimitPerMin: f.get('rateLimitPerMin') ? Number(f.get('rateLimitPerMin')) : undefined,
        dataHandling: f.get('dataHandling'), stopConditions: f.get('stopConditions'), escalationContact: f.get('escalationContact'),
      } });
      e.target.reset(); setOpen(false); onCreated();
    } catch (err) { setError(err.body?.errors?.join('; ') || errorText(err)); }
  }
  if (!open) return <button type="button" className="btn" onClick={() => setOpen(true)} style={{ marginBottom: 12 }}>Add scope record</button>;
  return (
    <form className="card" onSubmit={submit} style={{ marginBottom: 16 }}>
      <p className="sub" style={{ marginTop: 0 }}>Record only what the program owner authorized in writing. Anything not listed stays out of scope (passive review only).</p>
      <div className="row">
        <label style={{ flex: 1 }}>Program name<input name="programName" required /></label>
        <label style={{ flex: 1 }}>Program owner (who authorized this)<input name="programOwner" required /></label>
      </div>
      <div className="row">
        <label style={{ flex: 1 }}>Authorized assets (one per line, e.g. app.example.com or *.example.com)<textarea name="authorizedAssets" rows={3} required /></label>
        <label style={{ flex: 1 }}>Excluded assets<textarea name="excludedAssets" rows={3} /></label>
      </div>
      <div className="row">
        <label style={{ flex: 1 }}>Permitted test types (one per line)<textarea name="permittedTests" rows={3} required /></label>
        <label style={{ flex: 1 }}>Excluded test types (one per line)<textarea name="excludedTests" rows={3} required placeholder="dos" /></label>
      </div>
      <div className="row">
        <label style={{ flex: 1 }}>Window start<input type="date" name="windowStart" /></label>
        <label style={{ flex: 1 }}>Window end<input type="date" name="windowEnd" /></label>
        <label style={{ flex: 1 }}>Rate limit (requests/min)<input type="number" min="1" name="rateLimitPerMin" /></label>
      </div>
      <label>Data handling rules<textarea name="dataHandling" rows={2} required /></label>
      <label>Stop conditions<textarea name="stopConditions" rows={2} required /></label>
      <label>Escalation contact<input name="escalationContact" required /></label>
      {error && <p role="alert" className="s-err">{error}</p>}
      <div className="row"><button className="btn">Save scope record</button><button type="button" className="btn secondary" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  );
}

export default function Security() {
  const { role } = useOrg();
  const scopes = useOrgApi('/security/scopes');
  const findings = useOrgApi('/security/findings');
  const canManage = ['ORG_ADMIN', 'PLATFORM_OWNER'].includes(role);
  return (
    <>
      <h1>Defensive Security Center</h1>
      <p className="sub">No active testing without a written scope record. Unclear scope means passive review only; external disclosure requires human approval.</p>
      <h2 style={{ fontSize: 15 }}>Authorized bug-bounty programs</h2>
      {canManage ? scopes.orgId && <NewScope orgId={scopes.orgId} onCreated={scopes.reload} /> : <p className="sub">Only organization admins can add scope records.</p>}
      <Data q={scopes} empty="No scope records. Active security testing is disabled.">
        {(list) => <div className="table-wrap"><table><thead><tr><th>Program</th><th>Owner</th><th>Assets</th><th>Permitted tests</th><th>Window ends</th></tr></thead>
          <tbody>{list.map((s) => <tr key={s._id}><td>{s.programName}</td><td>{s.programOwner}</td><td>{s.authorizedAssets.join(', ')}</td><td>{s.permittedTests.join(', ')}</td><td>{s.windowEnd ? new Date(s.windowEnd).toLocaleDateString() : '—'}</td></tr>)}</tbody></table></div>}
      </Data>
      <h2 style={{ fontSize: 15, marginTop: 20 }}>Findings</h2>
      <Data q={findings} empty="No findings recorded.">
        {(list) => <div className="table-wrap"><table><thead><tr><th>Title</th><th>Asset</th><th>Severity</th><th>Confidence</th><th>Status</th></tr></thead>
          <tbody>{list.map((f) => <tr key={f._id}><td>{f.title}</td><td>{f.asset}</td><td>{f.severity}</td><td>{f.confidence}</td><td><StatusBadge status={f.status} /></td></tr>)}</tbody></table></div>}
      </Data>
    </>
  );
}
