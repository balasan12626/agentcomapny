'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useOrgApi } from '@/lib/useApi';
import { Data } from '@/components/States';
import { StatusBadge } from '@/components/StatusBadge';
import { SkillAssignment } from '@/components/SkillAssignment';
import { Preflight } from '@/components/Preflight';

const TABS = ['Overview', 'Requirements', 'Task Board', 'Workflow', 'Skills'];
const OPEN_STATES = new Set(['QUEUED', 'PLANNING', 'RUNNING', 'VALIDATING', 'RETRYING', 'AWAITING_APPROVAL', 'NEEDS_INPUT', 'PAUSED', 'STALLED']);
const COLUMNS = [
  ['Queued', ['QUEUED', 'RETRYING']], ['In progress', ['PLANNING', 'RUNNING', 'VALIDATING']],
  ['Needs attention', ['STALLED', 'NEEDS_INPUT', 'PAUSED', 'AWAITING_APPROVAL']], ['Done', ['COMPLETED']], ['Closed', ['FAILED', 'CANCELLED']],
];

export default function ProjectWorkspace({ params }) {
  const { projectId } = use(params);
  const query = useOrgApi(`/projects/${projectId}`);
  const pf = useOrgApi(`/projects/${projectId}/preflight`);
  const [tab, setTab] = useState('Overview');

  return (
    <Data q={query} empty="This project is unavailable or you do not have access.">
      {({ project, client, tasks }) => {
        const openTasks = tasks.filter((task) => OPEN_STATES.has(task.status));
        const attention = tasks.filter((task) => ['STALLED', 'FAILED', 'NEEDS_INPUT'].includes(task.status));
        return (
          <>
            <p className="sub">{client ? <><Link href={`/clients/${client._id}`}>{client.name}</Link> / </> : <><Link href="/projects">Projects</Link> / </>}{project.name}</p>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div><h1>{project.name}</h1><p className="sub">{client ? `Client: ${client.name}` : <span className="s-warn">No client — assign one on Projects</span>}{project.archivedAt ? ' · archived' : ''}</p></div>
              <div className="row">
                <Link className="btn secondary" href="/projects">Edit workspace</Link>
                <Link className="btn" href={`/ceo?projectId=${project._id}`}>Brief CEO</Link>
              </div>
            </div>
            <div className="row" style={{ gap: 20, flexWrap: 'wrap', margin: '12px 0 4px' }}>
              <span><strong>{tasks.length}</strong> recorded tasks</span>
              <span><strong>{openTasks.length}</strong> open</span>
              <span><strong>{attention.length}</strong> stalled, failed or needing input</span>
            </div>

            <div className="tabs" role="tablist" aria-label={`${project.name} workspace`}>
              {TABS.map((name) => <button key={name} type="button" role="tab" className="tab" aria-selected={tab === name} onClick={() => setTab(name)}>{name}</button>)}
            </div>

            {tab === 'Overview' && <>
              <Preflight result={pf.data} loading={pf.loading} />
              <h2 style={{ fontSize: 16 }}>Recent tasks</h2>
              <TaskRows tasks={tasks.slice(0, 8)} />
            </>}

            {tab === 'Requirements' && <>
              <p className="sub">Structured requirement records (versioned specs, sign-off) are not built yet. Below are the requirements actually captured so far: each brief and the acceptance criteria it was judged against.</p>
              {tasks.filter((t) => t.kind !== 'chat').length ? tasks.filter((t) => t.kind !== 'chat').map((t) => (
                <section className="card" key={t._id} style={{ marginBottom: 10 }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}><Link href={`/tasks/${t._id}`}><strong>{t.instruction.length > 160 ? `${t.instruction.slice(0, 159)}…` : t.instruction}</strong></Link><StatusBadge status={t.status} /></div>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{(t.acceptanceCriteria || []).map((c) => <li key={c.id} className="sub">{c.status === 'PASSED' ? '☑' : c.status === 'FAILED' ? '☒' : '☐'} {c.description}</li>)}</ul>
                </section>
              )) : <div className="state">No briefs recorded for this project yet.</div>}
            </>}

            {tab === 'Skills' && <SkillAssignment
              endpoint={`/projects/${project._id}/skills`}
              currentSkillSlugs={project.skillSlugs || []}
              scopeLabel="Project"
              orgId={query.orgId}
              onSaved={query.reload}
            />}

            {tab === 'Task Board' && (tasks.length ? <div className="kanban">
              {COLUMNS.map(([label, states]) => {
                const col = tasks.filter((t) => states.includes(t.status));
                return <section key={label} aria-label={label}>
                  <h3>{label} <span className="sub">{col.length}</span></h3>
                  {col.map((t) => <Link key={t._id} href={`/tasks/${t._id}`} className="card" style={{ display: 'block', textDecoration: 'none' }}>
                    <span className="clip" title={t.instruction}>{t.instruction}</span>
                    <div className="row" style={{ marginTop: 6, justifyContent: 'space-between' }}><StatusBadge status={t.status} /><span className="sub">{t.agents.length} agent(s)</span></div>
                  </Link>)}
                  {!col.length && <p className="sub" style={{ margin: 0 }}>Empty</p>}
                </section>;
              })}
            </div> : <div className="state">No tasks recorded for this project.</div>)}

            {tab === 'Workflow' && (tasks.length ? <div className="card">
              {tasks.map((task) => <section key={task._id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <Link href={`/tasks/${task._id}`} className="clip" title={task.instruction} style={{ flex: 1 }}>{task.instruction}</Link>
                  <StatusBadge status={task.status} />
                </div>
                {task.plan?.stages?.length
                  ? <ol className="stage-list">{task.plan.stages.map((stage, index) => <li key={index}>{stage.join(', ')}{stage.length > 1 ? ' (parallel)' : ''}</li>)}</ol>
                  : <p className="sub" style={{ margin: '4px 0 0' }}>Workflow plan not recorded</p>}
              </section>)}
            </div> : <div className="state">No workflow tasks are recorded for this project.</div>)}
          </>
        );
      }}
    </Data>
  );
}

function TaskRows({ tasks }) {
  if (!tasks.length) return <div className="state">No tasks recorded for this project.</div>;
  return <div className="table-wrap"><table>
    <thead><tr><th>Task</th><th>Mode</th><th>Assigned roles</th><th>Status</th><th>Workflow</th></tr></thead>
    <tbody>{tasks.map((task) => <tr key={task._id}>
      <td><span className="clip" title={task.instruction}>{task.instruction}</span></td>
      <td>{task.mode}</td>
      <td><span className="clip" title={task.agents.map((a) => a.slug).join(', ')}>{task.agents.map((agent) => agent.slug).join(', ') || 'Unassigned'}</span></td>
      <td><StatusBadge status={task.status} /></td>
      <td><Link href={`/tasks/${task._id}`}>Open graph</Link></td>
    </tr>)}</tbody>
  </table></div>;
}
