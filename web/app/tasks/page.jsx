'use client';
import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useOrgApi, invalidate } from '@/lib/useApi';
import { api, errorText } from '@/lib/api';
import { Data } from '@/components/States';
import { StatusBadge } from '@/components/StatusBadge';
import { AgentPicker } from '@/components/AgentPicker';
import { Preflight, QueueAnywayPrompt, isBlocked } from '@/components/Preflight';

const FILTERS = [
  ['All', ''], ['Active', 'QUEUED,PLANNING,RUNNING,VALIDATING,RETRYING'], ['Stalled', 'STALLED'], ['Needs attention', 'NEEDS_INPUT,PAUSED,AWAITING_APPROVAL'],
  ['Completed', 'COMPLETED'], ['Failed', 'FAILED'], ['Cancelled', 'CANCELLED'],
];
const PAGE = 25;

function NewTask({ orgId, onCreated }) {
  const router = useRouter();
  const projects = useOrgApi('/projects');
  const agents = useOrgApi('/agents');
  const [projectId, setProjectId] = useState('');
  const [how, setHow] = useState('ceo');
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const list = projects.data || [];
  const pid = projectId || list.find((p) => p.workspace?.configured)?._id || list[0]?._id || '';
  const pf = useOrgApi(pid ? `/projects/${pid}/preflight` : null);
  const [queueAnyway, setQueueAnyway] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const instruction = String(f.get('instruction') || '').trim();
    if (how === 'ceo') { router.push(`/ceo?projectId=${pid}&brief=${encodeURIComponent(instruction)}`); return; }
    if (!selected.length) { setError('Pick at least one agent, or let the CEO choose the team.'); return; }
    setBusy(true); setError(null);
    try {
      const res = await api(`/orgs/${orgId}/tasks`, { method: 'POST', body: {
        projectId: pid, instruction, mode: f.get('mode'),
        agents: selected.map((slug) => ({ slug })), idempotencyKey: crypto.randomUUID(),
        budget: f.get('maxTokens') ? { maxTokens: Number(f.get('maxTokens')) } : undefined,
        ...(queueAnyway ? { queueAnyway: true } : {}),
      } });
      e.target.reset(); setSelected([]); onCreated(res.task);
    } catch (err) { setError(errorText(err)); }
    setBusy(false);
  }
  if (projects.loading && !projects.data) return null;
  if (!list.length) return <div className="state">Create a project with an authorized workspace before submitting tasks. <Link href="/projects">Projects →</Link></div>;
  return (
    <form className="card" onSubmit={submit} style={{ marginBottom: 16 }}>
      <div className="row">
        <label style={{ flex: 2 }}>Project
          <select value={pid} onChange={(e) => setProjectId(e.target.value)}>
            {list.map((p) => <option key={p._id} value={p._id}>{p.clientName ? `${p.clientName} · ` : ''}{p.name}{p.workspace?.configured ? '' : ' — no workspace'}</option>)}
          </select>
        </label>
        <label style={{ flex: 1 }}>Mode<select name="mode" defaultValue="STANDARD">{['QUICK', 'STANDARD', 'DEEP', 'PARALLEL'].map((m) => <option key={m}>{m}</option>)}</select></label>
        <label style={{ flex: 1 }}>Token budget (optional)<input name="maxTokens" type="number" min="1000" step="1000" /></label>
      </div>
      <Preflight result={pf.data} loading={pf.loading} projectHref={pid ? `/projects/${pid}` : null} queueAnyway={queueAnyway} onQueueAnywayChange={setQueueAnyway} />
      <label>Instruction<textarea name="instruction" rows={3} required minLength={3} placeholder="Describe the outcome, e.g. Add a /health endpoint with a test." /></label>
      <fieldset className="row" style={{ border: 0, padding: 0, margin: '0 0 10px' }}>
        <legend className="sr-only">Who does the work</legend>
        <label className="check"><input type="radio" name="how" checked={how === 'ceo'} onChange={() => setHow('ceo')} /> Let the CEO choose the team <span className="sub">(recommended — previews the plan first)</span></label>
        <label className="check"><input type="radio" name="how" checked={how === 'manual'} onChange={() => setHow('manual')} /> Pick agents myself</label>
      </fieldset>
      {how === 'manual' && (agents.data ? <AgentPicker agents={agents.data} value={selected} onChange={setSelected} /> : <p className="sub">Loading agents…</p>)}
      {error && <p role="alert" className="s-err">{error}</p>}
      <button className="btn" disabled={busy || (how === 'manual' && isBlocked(pf.data, queueAnyway))} style={{ marginTop: 10 }}>{how === 'ceo' ? 'Plan with the CEO →' : busy ? 'Submitting…' : 'Submit task'}</button>
    </form>
  );
}

function TasksView() {
  const search = useSearchParams();
  const router = useRouter();
  const status = search.get('status') || '';
  const [projectId, setProjectId] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [skip, setSkip] = useState(0);
  useEffect(() => { const t = setTimeout(() => { setQuery(q.trim()); setSkip(0); }, 300); return () => clearTimeout(t); }, [q]);
  const params = useMemo(() => {
    const p = new URLSearchParams({ limit: String(PAGE), skip: String(skip) });
    if (status) p.set('status', status);
    if (projectId) p.set('projectId', projectId);
    if (query) p.set('q', query);
    return p.toString();
  }, [status, projectId, query, skip]);
  const tasks = useOrgApi(`/tasks?${params}`);
  const projects = useOrgApi('/projects');
  const [actionError, setActionError] = useState(null);
  const [retryRefused, setRetryRefused] = useState(null);
  const refresh = () => { invalidate('/tasks'); tasks.reload(); };
  const retry = async (id, queueAnyway = false) => {
    setActionError(null); setRetryRefused(null);
    try { await api(`/orgs/${tasks.orgId}/tasks/${id}/retry`, { method: 'POST', body: queueAnyway ? { queueAnyway: true } : undefined }); refresh(); }
    catch (err) { if (err.body?.code === 'WORKER_OFFLINE') setRetryRefused({ id, err }); else setActionError(errorText(err)); }
  };
  const setStatus = (value) => { setSkip(0); router.replace(value ? `/tasks?status=${value}` : '/tasks'); };

  return (
    <>
      <h1>Tasks</h1>
      <p className="sub">Submitted tasks run asynchronously through the durable queue and Claude Code.</p>
      {tasks.orgId && <NewTask orgId={tasks.orgId} onCreated={refresh} />}
      <div className="chips" role="group" aria-label="Filter by status">
        {FILTERS.map(([label, value]) => <button key={label} type="button" className="chip" aria-pressed={status === value} onClick={() => setStatus(value)}>{label}</button>)}
      </div>
      <div className="row" style={{ marginBottom: 10 }}>
        <label style={{ flex: 1, margin: 0 }}><span className="sr-only">Project</span>
          <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setSkip(0); }}>
            <option value="">All projects</option>
            {(projects.data || []).map((p) => <option key={p._id} value={p._id}>{p.clientName ? `${p.clientName} · ` : ''}{p.name}</option>)}
          </select>
        </label>
        <label style={{ flex: 2, margin: 0 }}><span className="sr-only">Search tasks</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search task instructions" /></label>
      </div>
      {actionError && <p role="alert" className="s-err">{actionError}</p>}
      <QueueAnywayPrompt error={retryRefused?.err} onConfirm={() => retry(retryRefused.id, true)} onDismiss={() => setRetryRefused(null)} />
      <Data q={tasks} empty={status || query || projectId ? 'No tasks match these filters.' : 'No tasks yet.'}>
        {(list) => (
          <>
            <div className="table-wrap"><table>
              <thead><tr><th>Task</th><th>Project</th><th>Agents</th><th>Status</th><th>Tokens</th><th>Created</th><th /></tr></thead>
              <tbody>{list.map((t) => (
                <tr key={t._id}>
                  <td><Link href={`/tasks/${t._id}`} className="clip" title={t.instruction}>{t.instruction}</Link>{t.kind === 'chat' && <span className="sub"> · chat</span>}</td>
                  <td><span className="clip" title={t.projectName}>{t.projectName}</span></td>
                  <td><span className="clip" title={t.agents.map((a) => a.slug).join(', ')}>{t.agents.map((a) => a.slug).join(', ')}</span></td>
                  <td><StatusBadge status={t.status} /></td>
                  <td>{((t.usage?.inputTokens || 0) + (t.usage?.outputTokens || 0)).toLocaleString()}</td>
                  <td>{new Date(t.createdAt).toLocaleString()}</td>
                  <td>{['STALLED', 'NEEDS_INPUT'].includes(t.status) && <button type="button" className="btn secondary small" onClick={() => retry(t._id)} title={t.stall?.reason || t.error}>Retry</button>}</td>
                </tr>
              ))}</tbody>
            </table></div>
            <div className="row" style={{ marginTop: 10 }}>
              <button type="button" className="btn secondary small" disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - PAGE))}>← Newer</button>
              <span className="sub">{skip + 1}–{skip + list.length}</span>
              <button type="button" className="btn secondary small" disabled={list.length < PAGE} onClick={() => setSkip(skip + PAGE)}>Older →</button>
            </div>
          </>
        )}
      </Data>
    </>
  );
}

export default function Tasks() {
  return <Suspense fallback={null}><TasksView /></Suspense>;
}
