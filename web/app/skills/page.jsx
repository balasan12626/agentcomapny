'use client';
import { useState } from 'react';
import { useOrgApi } from '@/lib/useApi';
import { api } from '@/lib/api';
import { Data } from '@/components/States';

const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => (typeof x === 'string' ? x : x?.message || x?.path || JSON.stringify(x)));

// Turn validator / save responses into a readable outcome.
function Outcome({ result }) {
  if (!result) return null;
  const errors = asList(result.errors || result.skill?.errors || (result.error ? [result.error] : []));
  const warnings = asList(result.warnings || result.skill?.warnings);
  const quarantined = asList(result.quarantined);
  const saved = result.version ? `${result.skill.slug} v${result.version.version}` : null;
  const ok = !errors.length && (saved || result.valid !== false);
  return (
    <div className={`alert ${ok ? 's-ok' : 's-err'}`} role={ok ? 'status' : 'alert'} style={{ marginTop: 12 }}>
      <p><strong>{saved ? `Saved draft ${saved}. A different reviewer must approve it before use.` : ok ? 'Valid SKILL.md.' : `${errors.length} problem(s) to fix:`}</strong></p>
      {errors.length > 0 && <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: 'var(--text)' }}>{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      {warnings.length > 0 && <><p className="s-warn" style={{ marginTop: 8 }}>Warnings</p><ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text)' }}>{warnings.map((w) => <li key={w}>{w}</li>)}</ul></>}
      {quarantined.length > 0 && <p className="sub" style={{ marginTop: 8 }}>Quarantined for review: {quarantined.join(', ')}</p>}
    </div>
  );
}

export default function Skills() {
  const q = useOrgApi('/skills');
  const [content, setContent] = useState('---\nname: my-skill\ndescription: Use when …\n---\n\n## Workflow\n1. …\n\n## Acceptance\n- [ ] …\n');
  const [result, setResult] = useState(null);
  const run = async (save) => {
    try {
      const r = save
        ? await api(`/orgs/${q.orgId}/skills`, { method: 'POST', body: { content, rationale: 'created in Skills Library' } })
        : await api(`/orgs/${q.orgId}/skills/validate`, { method: 'POST', body: { files: [{ path: 'skill/SKILL.md', content }] } });
      setResult(r); if (save) q.reload();
    } catch (e) { setResult(e.body || { errors: [e.message] }); }
  };
  return (
    <>
      <h1>Skills Library</h1>
      <p className="sub">Imported skills are untrusted until reviewed. Executables and hooks are quarantined; a different reviewer must approve each version.</p>
      <div className="split">
        <div className="card">
          <label>SKILL.md<textarea rows={14} value={content} onChange={(e) => { setContent(e.target.value); setResult(null); }} spellCheck={false} style={{ fontFamily: 'ui-monospace, monospace' }} /></label>
          <div className="row"><button type="button" className="btn secondary" onClick={() => run(false)}>Validate</button><button type="button" className="btn" onClick={() => run(true)}>Save as draft version</button></div>
          <Outcome result={result} />
        </div>
        <Data q={q} empty="No tenant skills yet. Repository skills live in .claude/skills/.">
          {(list) => <div className="card"><h3>Skills</h3><ul>{list.map((s) => <li key={s._id}>{s.slug} · {s.activeVersion ? `approved v${s.activeVersion}` : 'draft only'}</li>)}</ul></div>}
        </Data>
      </div>
    </>
  );
}
