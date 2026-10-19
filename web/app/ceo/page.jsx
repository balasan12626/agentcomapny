'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useOrgApi } from '@/lib/useApi';
import { api } from '@/lib/api';
import { Data } from '@/components/States';

// CEO Orchestrator — the natural-language front door. You describe what you
// want; the Founder/CEO selects a MINIMAL team from the company catalogue
// (never everyone), shows the dependency-ordered plan, and on your explicit
// "Execute" turns it into a real Task dispatched to the Claude Code runtime.
// Preview uses the server's dryRun (no side effects); Execute persists + enqueues.

function PlanView({ result }) {
  const { plan, task } = result;
  const stages = task?.plan?.stages || [];
  return (
    <div className="card" style={{ marginTop: 16 }} aria-live="polite">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h3 style={{ margin: 0 }}>CEO plan {result.dryRun ? '(preview — nothing executed)' : ''}</h3>
        <span className="badge" style={{ color: '#8b5cf6' }}>{plan.intent}</span>
      </div>
      <p className="sub">{plan.summary}</p>

      <h4 style={{ marginBottom: 6 }}>Departments engaged</h4>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {plan.departments.length
          ? plan.departments.map((d) => <span key={d} className="badge" style={{ color: '#38bdf8' }}>{d}</span>)
          : <span className="sub">none</span>}
      </div>

      <h4 style={{ marginTop: 14, marginBottom: 6 }}>Core roles selected ({plan.coreRoles.length})</h4>
      <div className="grid">
        {plan.coreRoles.map((r) => (
          <div className="card" key={r.slug} style={{ margin: 0 }}>
            <strong>{r.name}</strong>
            <p className="sub" style={{ margin: '2px 0' }}>{r.slug} · {r.departmentSlug} · relevance {r.score}</p>
            <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
              {(plan.subAgents.filter((s) => s.coreRoleSlug === r.slug)).map((s) => (
                <span key={s.slug} className="badge" style={{ color: '#9a9ab0', fontWeight: 500 }}>{s.name}</span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <h4 style={{ marginTop: 14, marginBottom: 6 }}>Execution stages (dependency-ordered)</h4>
      <ol style={{ margin: 0, paddingLeft: 18 }}>
        {stages.map((stage, i) => (
          <li key={i}>Stage {i + 1}{stage.length > 1 ? ' (parallel)' : ''}: {stage.join(', ')}</li>
        ))}
      </ol>

      <h4 style={{ marginTop: 14, marginBottom: 6 }}>Acceptance criteria</h4>
      <ul style={{ margin: 0 }}>
        {(task?.acceptanceCriteria || []).map((c) => <li key={c.id} className="sub">{c.description}</li>)}
      </ul>
    </div>
  );
}

export default function Ceo() {
  const projects = useOrgApi('/projects');
  const { orgId } = projects;
  const router = useRouter();
  const [request, setRequest] = useState('');
  const [projectId, setProjectId] = useState('');
  const [mode, setMode] = useState('STANDARD');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // 'preview' | 'execute' | null

  const pid = projectId || projects.data?.[0]?._id || '';

  async function run(execute) {
    if (!orgId || !pid || request.trim().length < 2) {
      setError('Pick a project and describe the work (a few words at least).');
      return;
    }
    setBusy(execute ? 'execute' : 'preview');
    setError(null);
    try {
      const res = await api(`/orgs/${orgId}/ceo/execute`, {
        method: 'POST',
        body: { request: request.trim(), projectId: pid, mode, execute, idempotencyKey: crypto.randomUUID() },
      });
      if (execute && res.task?._id) { router.push(`/tasks/${res.task._id}`); return; }
      setPreview(res);
    } catch (err) {
      // 422 = CEO could not map the request to any capability.
      if (err.status === 422) setError(err.body?.error || 'The CEO could not map this to a capability — try naming the outcome more concretely.');
      else setError(err.body?.issues?.map((i) => `${i.path}: ${i.message}`).join('; ') || err.message);
      setPreview(null);
    }
    setBusy(null);
  }

  return (
    <>
      <h1>CEO Orchestrator</h1>
      <p className="sub">Describe the outcome in plain language. The Founder/CEO picks the smallest sufficient team from the 50 core roles, orders the work by dependency, and — only when you execute — dispatches it to the Claude Code runtime.</p>

      <Data q={projects} empty="Create a project with an authorized workspace before orchestrating work.">
        {(list) => (
          <form className="card" onSubmit={(e) => { e.preventDefault(); run(false); }}>
            <div className="row">
              <label style={{ flex: 1 }}>Project
                <select value={projectId || list[0]?._id} onChange={(e) => setProjectId(e.target.value)}>
                  {list.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
                </select>
              </label>
              <label style={{ flex: 1 }}>Mode
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  {['QUICK', 'STANDARD', 'DEEP', 'PARALLEL'].map((m) => <option key={m}>{m}</option>)}
                </select>
              </label>
            </div>
            <label>Your request
              <textarea rows={3} value={request} onChange={(e) => setRequest(e.target.value)} required minLength={2}
                placeholder="e.g. Build a marketplace with product catalog, user login, checkout, and automated tests." />
            </label>
            {error && <p role="alert" className="s-err">{error}</p>}
            <div className="row">
              <button className="btn secondary" type="submit" disabled={!!busy}>{busy === 'preview' ? 'Planning…' : 'Preview CEO plan'}</button>
              <button className="btn" type="button" disabled={!!busy || !preview} onClick={() => run(true)}
                title={preview ? 'Persist and dispatch to the Claude Code runtime' : 'Preview a plan first'}>
                {busy === 'execute' ? 'Dispatching…' : 'Execute with CEO →'}
              </button>
            </div>
          </form>
        )}
      </Data>

      {preview && <PlanView result={preview} />}
    </>
  );
}
