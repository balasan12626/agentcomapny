'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useOrgApi, invalidate } from '@/lib/useApi';
import { api, errorText } from '@/lib/api';
import { Data } from '@/components/States';
import { Preflight, isBlocked } from '@/components/Preflight';

const LAST_PROJECT = 'dl_last_project';

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
        <span className="badge" style={{ color: 'var(--tone-violet)' }}>{plan.intent}</span>
      </div>
      <p className="sub">{plan.summary}</p>
      {result.requiresClarification && <p role="status" className="s-err">I need a little more detail before assigning a team. Describe the outcome and the service area, such as software development, marketing, analytics, or AI.</p>}

      <h4 style={{ marginBottom: 6 }}>Departments engaged</h4>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {plan.departments.length
          ? plan.departments.map((d) => <span key={d} className="badge" style={{ color: 'var(--tone-sky)' }}>{d}</span>)
          : <span className="sub">none</span>}
      </div>

      <h4 style={{ marginTop: 14, marginBottom: 6 }}>Management assignments</h4>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {(plan.departmentHeads || []).map((head) => (
          <span key={head.slug} className="badge" style={{ color: 'var(--tone-amber)' }}>{head.title} · {head.departmentSlug}</span>
        ))}
        {plan.projectManager && <span className="badge" style={{ color: 'var(--tone-amber)' }}>Project Manager · {plan.projectManager.slug}</span>}
      </div>

      <h4 style={{ marginTop: 14, marginBottom: 6 }}>Core roles selected ({plan.coreRoles.length})</h4>
      <div className="grid">
        {plan.coreRoles.map((r) => (
          <div className="card" key={r.slug} style={{ margin: 0 }}>
            <strong>{r.name}</strong>
            <p className="sub" style={{ margin: '2px 0' }}>{r.slug} · {r.departmentSlug} · relevance {r.score}</p>
            <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
              {(plan.subAgents.filter((s) => s.coreRoleSlug === r.slug)).map((s) => (
                <span key={s.slug} className="badge" style={{ color: 'var(--tone-slate)', fontWeight: 500 }}>{s.name}</span>
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

      <h4 style={{ marginTop: 14, marginBottom: 6 }}>CFO budget allocation</h4>
      {result.cfo ? (
        <>
          <table>
            <thead><tr><th>Role</th><th>Department</th><th>Weight</th><th>Hard cap</th></tr></thead>
            <tbody>
              {result.cfo.allocations.map((a) => (
                <tr key={a.slug}><td>{a.name}</td><td className="sub">{a.departmentSlug}</td><td>{a.weight}</td><td><strong>${a.maxCostUsd.toFixed(2)}</strong></td></tr>
              ))}
              <tr><td>Reserve (retries / validation)</td><td /><td /><td>${result.cfo.reserveUsd.toFixed(2)}</td></tr>
            </tbody>
          </table>
          <p className="sub" style={{ marginTop: 4 }}>Total ${result.cfo.totalUsd.toFixed(2)} approved by the CFO. Each agent is stopped by Claude Code if it exceeds its cap.</p>
        </>
      ) : <p className="sub">No budget set — agents run without a per-agent cap. Enter a budget above to have the CFO split it.</p>}

      <h4 style={{ marginTop: 14, marginBottom: 6 }}>Acceptance criteria</h4>
      <ul style={{ margin: 0 }}>
        {(task?.acceptanceCriteria || []).map((c) => <li key={c.id} className="sub">{c.description}</li>)}
      </ul>
    </div>
  );
}

function CeoView() {
  const projects = useOrgApi('/projects');
  const catalog = useOrgApi('/catalog');
  const { orgId } = projects;
  const router = useRouter();
  const search = useSearchParams();
  const [request, setRequest] = useState(search.get('brief') || '');
  const [projectId, setProjectId] = useState(search.get('projectId') || '');
  const [mode, setMode] = useState('STANDARD');
  const [budgetUsd, setBudgetUsd] = useState('');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // 'preview' | 'execute' | null

  // Default: the project named in the URL, else the last one used here, else
  // the first project that has a workspace — never silently one that can't run.
  useEffect(() => {
    if (projectId || !projects.data?.length) return;
    let last = null;
    try { last = localStorage.getItem(LAST_PROJECT); } catch {}
    const usable = projects.data.filter((p) => p.workspace?.configured);
    setProjectId((usable.find((p) => p._id === last) || usable[0] || projects.data[0])._id);
  }, [projects.data, projectId]);
  const pid = projectId;
  const pf = useOrgApi(pid ? `/projects/${pid}/preflight` : null);
  const [queueAnyway, setQueueAnyway] = useState(false);
  const blocked = isBlocked(pf.data, queueAnyway);
  const roleCount = catalog.data?.counts?.coreRoles;

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
        body: { request: request.trim(), projectId: pid, mode, execute, idempotencyKey: crypto.randomUUID(), ...(execute && queueAnyway ? { queueAnyway: true } : {}), ...(Number(budgetUsd) > 0 ? { budgetUsd: Number(budgetUsd) } : {}) },
      });
      if (execute && res.task?._id) {
        try { localStorage.setItem(LAST_PROJECT, pid); } catch {}
        invalidate('/tasks');
        router.push(`/tasks/${res.task._id}`);
        return;
      }
      setPreview(res);
    } catch (err) {
      // 422 = CEO could not map the request to any capability; 409 = pre-flight failed.
      if (err.status === 422) setError(err.body?.error || 'The CEO could not map this to a capability — try naming the outcome more concretely.');
      else setError(errorText(err));
      if (['PREFLIGHT_FAILED', 'WORKER_OFFLINE'].includes(err.body?.code)) pf.reload();
      setPreview(null);
    }
    setBusy(null);
  }

  return (
    <>
      <h1>CEO Orchestrator</h1>
      <p className="sub">Describe the outcome in plain language. The Founder/CEO picks the smallest sufficient team{roleCount ? ` from the company's ${roleCount} core roles` : ' from the company catalogue'}, orders the work by dependency, and — only when you execute — dispatches it to the Claude Code runtime in the selected project.</p>

      <Data q={projects} empty="Create a project with an authorized workspace before orchestrating work.">
        {(list) => (
          <form className="card" onSubmit={(e) => { e.preventDefault(); run(false); }}>
            <div className="row">
              <label style={{ flex: 2 }}>Project
                <select value={pid} onChange={(e) => { setProjectId(e.target.value); setPreview(null); }}>
                  {list.map((p) => <option key={p._id} value={p._id}>{p.clientName ? `${p.clientName} · ` : ''}{p.name}{p.workspace?.configured ? '' : ' — no workspace'}</option>)}
                </select>
              </label>
              <label style={{ flex: 1 }}>Mode
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  {['QUICK', 'STANDARD', 'DEEP', 'PARALLEL'].map((m) => <option key={m}>{m}</option>)}
                </select>
              </label>
              <label style={{ flex: 1 }}>Budget (USD, CFO splits it)
                <input type="number" min="0.5" step="0.5" value={budgetUsd} onChange={(e) => { setBudgetUsd(e.target.value); setPreview(null); }} placeholder="e.g. 10" />
              </label>
            </div>
            <label>Your request
              <textarea rows={3} value={request} onChange={(e) => setRequest(e.target.value)} required minLength={2}
                placeholder="e.g. Build a marketplace with product catalog, user login, checkout, and automated tests." />
            </label>
            <Preflight result={pf.data} loading={pf.loading} projectHref={pid ? `/projects/${pid}` : null} queueAnyway={queueAnyway} onQueueAnywayChange={setQueueAnyway} />
            {error && <p role="alert" className="s-err">{error}</p>}
            <div className="row">
              <button className="btn secondary" type="submit" disabled={!!busy}>{busy === 'preview' ? 'Planning…' : 'Preview CEO plan'}</button>
              <button className="btn" type="button" disabled={!!busy || blocked || !preview || preview.requiresClarification || !preview.plan?.coreRoles?.length} onClick={() => run(true)}
                title={blocked ? 'Fix the pre-flight failures first' : preview?.requiresClarification ? 'Clarify the request before dispatching' : preview ? 'Persist and dispatch to the Claude Code runtime' : 'Preview a plan first'}>
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

export default function Ceo() {
  return <Suspense fallback={null}><CeoView /></Suspense>;
}
