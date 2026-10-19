'use client';
import { use } from 'react';
import Link from 'next/link';
import { useOrgApi } from '@/lib/useApi';
import { Data } from '@/components/States';
import { StatusBadge } from '@/components/StatusBadge';
import { Markdown } from '@/components/Markdown';

const KIND = { EXECUTIVE: 'Executive', DEPARTMENT_HEAD: 'Department head', CORE_ROLE: 'Core role', SUBAGENT: 'Sub-agent' };
const AgentLink = ({ a }) => <Link href={`/agents/${a.slug}`}>{a.name}</Link>;

export default function AgentDetail({ params }) {
  const { slug } = use(params);
  const q = useOrgApi(`/agents/${slug}`);
  return (
    <Data q={q} empty="Agent not found.">
      {({ agent, version, parent, head, subAgents, coordinates, runs }) => (
        <>
          <p className="sub"><Link href="/agents">Agents</Link> / {agent.department}</p>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div>
              <h1>{agent.name}</h1>
              <p className="sub">{agent.legacy ? 'Legacy agent (not in the company catalogue)' : KIND[agent.kind]} · {agent.slug} · {agent.enabled ? 'enabled' : 'disabled'}</p>
            </div>
            {!agent.legacy && agent.enabled && <Link className="btn" href={`/agents/${agent.slug}/chat`}>Chat with this agent</Link>}
          </div>

          <div className="grid" style={{ margin: '14px 0' }}>
            <div className="card"><h3>Published version</h3><div className="stat">{version ? `v${version.version}` : '—'}</div>{version?.publishedAt && <div className="sub">{new Date(version.publishedAt).toLocaleDateString()}</div>}</div>
            <div className="card"><h3>Runs (your projects)</h3><div className="stat">{runs.total}</div><div className="sub">{Object.entries(runs.byStatus).map(([s, n]) => `${n} ${s.toLowerCase()}`).join(' · ') || 'none yet'}</div></div>
            <div className="card"><h3>Last run</h3><div className="stat" style={{ fontSize: 16 }}>{runs.last ? <Link href={`/tasks/${runs.last.taskId}`}>{new Date(runs.last.startedAt).toLocaleString()}</Link> : '—'}</div>{runs.last && <StatusBadge status={runs.last.status} />}</div>
          </div>

          <div className="split">
            <section className="card">
              <h3>Purpose and instructions</h3>
              {version?.instructions ? <Markdown text={version.instructions} /> : <p className="sub">No published instructions.</p>}
            </section>
            <aside className="card">
              <h3>Reporting line</h3>
              <ul style={{ paddingLeft: 18 }}>
                {head && <li>Department head: <AgentLink a={head} /></li>}
                {parent && <li>Core role: <AgentLink a={parent} /></li>}
                {subAgents.length > 0 && <li>Sub-agents: {subAgents.map((s, i) => <span key={s.slug}>{i > 0 && ', '}<AgentLink a={s} /></span>)}</li>}
                {coordinates.length > 0 && <li>Coordinates: {coordinates.map((s, i) => <span key={s.slug}>{i > 0 && ', '}<AgentLink a={s} /></span>)}</li>}
                {!head && !parent && !subAgents.length && !coordinates.length && <li className="sub">No hierarchy links recorded.</li>}
              </ul>
              <h3>Tools</h3>
              <div className="chips">{(version?.allowedTools || []).map((t) => <span key={t} className="badge s-info">{t}</span>)}{!version?.allowedTools?.length && <span className="sub">Read-only defaults</span>}</div>
              {version?.deniedTools?.length > 0 && <p className="sub">Denied: {version.deniedTools.join(', ')}</p>}
              <h3>Skills</h3>
              <p className="sub">{version?.skills?.length ? version.skills.map((s) => s.slug).join(', ') : 'None pinned'}</p>
              <h3>Produces</h3>
              <p className="sub">{version?.produces?.length ? version.produces.join(', ') : '—'}</p>
              {version?.limits && Object.values(version.limits).some(Boolean) && <><h3>Limits</h3><p className="sub">{Object.entries(version.limits).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p></>}
              {version?.hash && <p className="sub" style={{ marginTop: 12 }}>Definition hash <code>{version.hash.slice(0, 12)}</code></p>}
            </aside>
          </div>
        </>
      )}
    </Data>
  );
}
