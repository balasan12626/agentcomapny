'use client';
import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useOrgApi } from '@/lib/useApi';
import { api } from '@/lib/api';
import { useTaskEvents } from '@/lib/useTaskEvents';
import { Data } from '@/components/States';
import { StatusBadge } from '@/components/StatusBadge';
import { Markdown } from '@/components/Markdown';
import { QueueAnywayPrompt } from '@/components/Preflight';

// Chat with ONE specialist. Every message is a real single-agent run through
// the governed pipeline (tenant scope + workspace path guard + usage). The
// agent answers only within its specialty — enforced by its own system prompt
// and scoped tools (e.g. the SEO specialist is read-only and SEO-focused, the
// QA engineer runs checks). Its Claude session is resumed so the thread has
// memory. Each message spends real Claude quota.
export default function AgentChat({ params }) {
  const { slug } = use(params);
  const agents = useOrgApi('/agents');
  const projects = useOrgApi('/projects');
  const { orgId } = agents;
  const agent = (agents.data || []).find((a) => a.slug === slug);
  const [projectId, setProjectId] = useState('');
  const pid = projectId || projects.data?.find((p) => p.workspace?.configured)?._id || projects.data?.[0]?._id || '';
  const conversationId = pid ? `chat-${slug}-${pid}` : '';
  const [thread, setThread] = useState([]);
  const [input, setInput] = useState('');
  const [activeTaskId, setActiveTaskId] = useState(null);
  const [resumeSessionId, setResumeSessionId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [refused, setRefused] = useState(null);
  const { events, connected } = useTaskEvents(orgId, activeTaskId);
  const endRef = useRef(null);

  async function loadThread() {
    if (!orgId || !conversationId) return;
    try {
      const h = await api(`/orgs/${orgId}/agents/${slug}/chat?conversationId=${encodeURIComponent(conversationId)}`);
      setThread(h);
      const lastWithSession = [...h].reverse().find((m) => m.sessionId);
      if (lastWithSession) setResumeSessionId(lastWithSession.sessionId);
    } catch { /* keep current thread */ }
  }
  useEffect(() => { loadThread(); /* eslint-disable-next-line */ }, [orgId, conversationId]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [thread, events]);

  // When the active message's task reaches a terminal state, refresh the thread.
  const last = events[events.length - 1];
  useEffect(() => {
    if (last?.kind === 'state' && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(last.data?.status)) {
      setBusy(false); setActiveTaskId(null); loadThread();
    }
    // eslint-disable-next-line
  }, [last]);

  async function send(e, { text, queueAnyway = false } = {}) {
    e?.preventDefault();
    const msg = (text ?? input).trim();
    if (!msg || !pid || busy) return;
    setBusy(true); setError(null); setRefused(null); setInput('');
    const pendingId = `pending-${Date.now()}`;
    setThread((t) => [...t, { _id: pendingId, message: msg, status: 'QUEUED', reply: null }]);
    try {
      const res = await api(`/orgs/${orgId}/agents/${slug}/chat`, { method: 'POST', body: { message: msg, projectId: pid, conversationId, resumeSessionId: resumeSessionId || undefined, ...(queueAnyway ? { queueAnyway: true } : {}) } });
      setActiveTaskId(res.task._id);
    } catch (err) {
      // Nothing was queued: drop the optimistic bubble and give the text back.
      setThread((t) => t.filter((m) => m._id !== pendingId)); setInput(msg);
      if (err.body?.code === 'WORKER_OFFLINE') setRefused({ err, msg }); else setError(err.body?.error || err.message);
      setBusy(false);
    }
  }

  // Live "what the agent is doing" line from the current run's events.
  const liveLine = (() => {
    if (!busy) return null;
    const m = [...events].reverse().find((e) => e.kind === 'agent_message' && e.data?.text);
    if (m) return m.data.text.slice(0, 160);
    const t = [...events].reverse().find((e) => e.kind === 'agent_tool_call');
    if (t) return 'using a tool…';
    return 'thinking…';
  })();

  if (!agents.loading && !agent) return <div className="state">Agent <code>{slug}</code> not found. <Link href="/catalog">Back to Company Org</Link></div>;

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>{agent?.name || slug}</h1>
          <p className="sub" style={{ margin: 0 }}>{agent?.department} · {agent?.type || 'specialist'} · chat with this specialist · live {connected ? 'connected' : '—'}</p>
        </div>
        <Link href="/catalog" className="btn secondary">← Company Org</Link>
      </div>

      <Data q={projects} empty="Create a project with an authorized workspace before chatting with an agent.">
        {(list) => (
          <>
            <div className="card" style={{ marginBottom: 12 }}>
              <label>Project (workspace the agent works in)
                <select value={pid} onChange={(e) => setProjectId(e.target.value)}>
                  {list.map((p) => <option key={p._id} value={p._id}>{p.clientName ? `${p.clientName} · ` : ''}{p.name}{p.workspace?.configured ? '' : ' — no workspace'}</option>)}
                </select>
              </label>
            </div>

            <div className="card chatlog" style={{ minHeight: 240, maxHeight: '55vh', overflowY: 'auto' }}>
              {thread.length === 0 && <p className="sub">No messages yet. Ask {agent?.name || 'this agent'} something in its specialty — it answers only within its domain.</p>}
              {thread.map((m) => (
                <div key={m._id} style={{ marginBottom: 14 }}>
                  <div style={{ textAlign: 'right' }}><span className="bubble you">{m.message}</span></div>
                  <div style={{ marginTop: 6 }}>
                    <strong style={{ fontSize: 12 }}>{agent?.name || slug}</strong> <StatusBadge status={m.status} />
                    {m.reply
                      ? <div className="bubble agent"><Markdown text={m.reply} /></div>
                      : m.error
                        ? <div className="s-err">{m.error}</div>
                        : <div className="sub">{m._id.startsWith('pending') && liveLine ? liveLine : '…'}</div>}
                  </div>
                </div>
              ))}
              {busy && liveLine && <p className="sub" aria-live="polite">● {agent?.name || slug} is working: {liveLine}</p>}
              <div ref={endRef} />
            </div>

            {error && <p role="alert" className="s-err">{error}</p>}
            <QueueAnywayPrompt error={refused?.err} onConfirm={() => send(null, { text: refused.msg, queueAnyway: true })} onDismiss={() => setRefused(null)} />
            <form className="row" onSubmit={send} style={{ marginTop: 10, gap: 8 }}>
              <input style={{ flex: 1 }} value={input} onChange={(e) => setInput(e.target.value)} placeholder={`Message ${agent?.name || slug}…`} disabled={busy} />
              <button className="btn" disabled={busy || !input.trim()}>{busy ? 'Working…' : 'Send'}</button>
            </form>
            <p className="sub" style={{ marginTop: 6 }}>Each message runs a real Claude Code session for this one agent (spends quota). The agent stays within its specialty and scoped tools.</p>
          </>
        )}
      </Data>
    </>
  );
}
