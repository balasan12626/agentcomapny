'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useOrgApi } from '@/lib/useApi';
import { Data } from '@/components/States';
import { StatusBadge } from '@/components/StatusBadge';
import { SkillAssignment } from '@/components/SkillAssignment';

const TABS = ['Overview', 'Projects', 'Tasks', 'Skills'];
const ACTIVE = new Set(['QUEUED', 'PLANNING', 'RUNNING', 'VALIDATING', 'RETRYING', 'AWAITING_APPROVAL', 'NEEDS_INPUT', 'PAUSED', 'STALLED']);
const ATTENTION = ['STALLED', 'NEEDS_INPUT', 'FAILED'];

export default function ClientWorkspace({ params }) {
  const { clientId } = use(params);
  const query = useOrgApi(`/clients/${clientId}`);
  const [tab, setTab] = useState('Overview');

  return (
    <Data q={query} empty="This client is unavailable or has no accessible projects.">
      {({ client, projects, tasks }) => {
        const activeTasks = tasks.filter((task) => ACTIVE.has(task.status));
        const blockedTasks = tasks.filter((task) => ATTENTION.includes(task.status));
        const awaitingApproval = tasks.filter((task) => task.status === 'AWAITING_APPROVAL');
        const tasksForProject = (projectId) => tasks.filter((task) => task.projectId === projectId || task.projectId?._id === projectId);

        return (
          <>
            <p className="sub"><Link href="/clients">Clients</Link> / {client.name}</p>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div><h1>{client.name}</h1><p className="sub">Client workspace · data limited to authorized projects</p></div>
              {projects[0] && <Link className="btn" href={`/ceo?projectId=${projects[0]._id}`}>Brief CEO</Link>}
            </div>

            <div className="row" style={{ margin: '12px 0 18px', gap: 20, flexWrap: 'wrap' }}>
              <span><strong>{projects.length}</strong> projects</span>
              <span><strong>{activeTasks.length}</strong> active tasks</span>
              <span><strong>{blockedTasks.length}</strong> stalled, failed or needing input</span>
              <span><strong>{awaitingApproval.length}</strong> awaiting approval</span>
            </div>

            <div className="tabs" role="tablist" aria-label={`${client.name} workspace`}>
              {TABS.map((name) => <button key={name} type="button" role="tab" className="tab" aria-selected={tab === name} onClick={() => setTab(name)}>{name}</button>)}
            </div>

            {tab === 'Overview' && (
              <>
                <h2 style={{ fontSize: 16 }}>Projects</h2>
                {projects.length ? <div className="grid">
                  {projects.map((project) => {
                    const projectTasks = tasksForProject(project._id);
                    return <section className="card" key={project._id}>
                      <h3><Link href={`/projects/${project._id}`}>{project.name}</Link></h3>
                      <p className="sub">{projectTasks.length} recorded task(s) · {project.workspace?.configured ? 'workspace configured' : 'workspace not configured'}</p>
                      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                        {projectTasks.slice(0, 4).map((task) => <Link className="badge" key={task._id} href={`/tasks/${task._id}`}>
                          {task.instruction.length > 40 ? `${task.instruction.slice(0, 39)}…` : task.instruction} · {task.status}
                        </Link>)}
                        {!projectTasks.length && <span className="sub">No tasks yet.</span>}
                      </div>
                    </section>;
                  })}
                </div> : <div className="state">No projects are available for this client.</div>}
                <h2 style={{ fontSize: 16, marginTop: 20 }}>Recent tasks</h2>
                <TaskTable tasks={tasks.slice(0, 8)} projects={projects} />
              </>
            )}

            {tab === 'Projects' && (
              <table>
                <thead><tr><th>Project</th><th>Tasks</th><th>Attention</th><th>Workflow</th></tr></thead>
                <tbody>{projects.map((project) => {
                  const projectTasks = tasksForProject(project._id);
                  const attention = projectTasks.filter((task) => [...ATTENTION, 'AWAITING_APPROVAL'].includes(task.status)).length;
                  return <tr key={project._id}>
                    <td><Link href={`/projects/${project._id}`}><strong>{project.name}</strong></Link></td>
                    <td>{projectTasks.length}</td><td>{attention}</td>
                    <td>{projectTasks[0] ? <Link href={`/tasks/${projectTasks[0]._id}`}>Open task graph</Link> : <span className="sub">No workflow yet</span>}</td>
                  </tr>;
                })}</tbody>
              </table>
            )}

            {tab === 'Tasks' && <TaskTable tasks={tasks} projects={projects} />}

            {tab === 'Skills' && <SkillAssignment
              endpoint={`/clients/${client._id}/skills`}
              currentSkillSlugs={client.skillSlugs || []}
              scopeLabel="Client default"
              orgId={query.orgId}
              onSaved={query.reload}
            />}
          </>
        );
      }}
    </Data>
  );
}

function TaskTable({ tasks, projects }) {
  if (!tasks.length) return <div className="state">No tasks recorded.</div>;
  const projectNames = new Map(projects.map((project) => [project._id, project.name]));
  return <table>
    <thead><tr><th>Task</th><th>Project</th><th>Status</th><th>Updated</th></tr></thead>
    <tbody>{tasks.map((task) => <tr key={task._id}>
      <td><Link href={`/tasks/${task._id}`} className="clip" title={task.instruction}>{task.instruction}</Link></td>
      <td>{projectNames.get(String(task.projectId?._id || task.projectId)) || 'Project unavailable'}</td>
      <td><StatusBadge status={task.status} /></td>
      <td>{task.updatedAt ? new Date(task.updatedAt).toLocaleString() : '—'}</td>
    </tr>)}</tbody>
  </table>;
}