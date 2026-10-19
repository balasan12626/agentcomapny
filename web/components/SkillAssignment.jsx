'use client';
import { useState } from 'react';
import { useOrgApi } from '@/lib/useApi';
import { api } from '@/lib/api';

export function SkillAssignment({ orgId, endpoint, currentSkillSlugs = [], onSaved, scopeLabel }) {
  const query = useOrgApi('/skills');
  const approved = (query.data || []).filter((skill) => skill.enabled && skill.activeVersion);
  const [selected, setSelected] = useState(currentSkillSlugs);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  async function save() {
    setBusy(true); setMessage(null); setError(null);
    try {
      const result = await api(`/orgs/${orgId}${endpoint}`, { method: 'PUT', body: { skillSlugs: selected } });
      setMessage(`${result.skillSlugs.length} approved skill(s) assigned. New tasks pin these versions.`);
      onSaved();
    } catch (e) { setError(e.body?.error || e.message); }
    setBusy(false);
  }

  return (
    <section>
      <h2 style={{ fontSize: 16 }}>{scopeLabel} skill set</h2>
      <p className="sub">Only approved versions are available. Client defaults are inherited by its projects; project selections add project-specific skills. Skills cannot grant extra tools.</p>
      {query.loading ? <p className="sub">Loading approved skills…</p> : approved.length ? (
        <label>Approved skills
          <select multiple size={Math.min(8, Math.max(3, approved.length))} value={selected} onChange={(e) => setSelected(Array.from(e.target.selectedOptions, (option) => option.value))}>
            {approved.map((skill) => <option key={skill._id} value={skill.slug}>{skill.slug} · v{skill.activeVersion}</option>)}
          </select>
        </label>
      ) : <div className="state">No approved skills available. <a href="/skills">Open Skills Library</a>; a different reviewer must approve drafts.</div>}
      {error && <p role="alert" className="s-err">{error}</p>}
      {message && <p role="status" className="s-ok">{message}</p>}
      {approved.length > 0 && <button type="button" className="btn" disabled={busy || !orgId} onClick={save}>{busy ? 'Saving…' : `Save ${scopeLabel.toLowerCase()} skills`}</button>}
      {currentSkillSlugs.length > 0 && <p className="sub" style={{ marginTop: 10 }}>Currently assigned: {currentSkillSlugs.join(', ')}</p>}
    </section>
  );
}