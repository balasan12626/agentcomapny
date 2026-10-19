'use client';
import { useState } from 'react';
import { useOrgApi } from '@/lib/useApi';
import { api } from '@/lib/api';
import { Data } from '@/components/States';

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
          <label>SKILL.md<textarea rows={14} value={content} onChange={(e) => setContent(e.target.value)} spellCheck={false} style={{ fontFamily: 'ui-monospace, monospace' }} /></label>
          <div className="row"><button className="btn secondary" onClick={() => run(false)}>Validate</button><button className="btn" onClick={() => run(true)}>Save as draft version</button></div>
          {result && <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{JSON.stringify(result.errors?.length ? { errors: result.errors, warnings: result.warnings } : result.version ? { saved: `${result.skill.slug}@${result.version.version}`, warnings: result.warnings } : { valid: result.valid, warnings: result.skill?.warnings, quarantined: result.quarantined }, null, 2)}</pre>}
        </div>
        <Data q={q} empty="No tenant skills yet. Repository skills live in .claude/skills/.">
          {(list) => <div className="card"><h3>Skills</h3><ul>{list.map((s) => <li key={s._id}>{s.slug} · active v{s.activeVersion || '— (draft only)'}</li>)}</ul></div>}
        </Data>
      </div>
    </>
  );
}
