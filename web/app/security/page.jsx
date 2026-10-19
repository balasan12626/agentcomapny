'use client';
import { useOrgApi } from '@/lib/useApi';
import { Data } from '@/components/States';
import { StatusBadge } from '@/components/StatusBadge';

export default function Security() {
  const scopes = useOrgApi('/security/scopes');
  const findings = useOrgApi('/security/findings');
  return (
    <>
      <h1>Defensive Security Center</h1>
      <p className="sub">No active testing without a written scope record. Unclear scope means passive review only; external disclosure requires human approval.</p>
      <h2 style={{ fontSize: 15 }}>Authorized bug-bounty programs</h2>
      <Data q={scopes} empty="No scope records. Active security testing is disabled.">
        {(list) => <table><thead><tr><th>Program</th><th>Owner</th><th>Assets</th><th>Permitted tests</th><th>Window ends</th></tr></thead>
          <tbody>{list.map((s) => <tr key={s._id}><td>{s.programName}</td><td>{s.programOwner}</td><td>{s.authorizedAssets.join(', ')}</td><td>{s.permittedTests.join(', ')}</td><td>{s.windowEnd ? new Date(s.windowEnd).toLocaleDateString() : '—'}</td></tr>)}</tbody></table>}
      </Data>
      <h2 style={{ fontSize: 15, marginTop: 20 }}>Findings</h2>
      <Data q={findings} empty="No findings recorded.">
        {(list) => <table><thead><tr><th>Title</th><th>Asset</th><th>Severity</th><th>Confidence</th><th>Status</th></tr></thead>
          <tbody>{list.map((f) => <tr key={f._id}><td>{f.title}</td><td>{f.asset}</td><td>{f.severity}</td><td>{f.confidence}</td><td><StatusBadge status={f.status} /></td></tr>)}</tbody></table>}
      </Data>
    </>
  );
}
