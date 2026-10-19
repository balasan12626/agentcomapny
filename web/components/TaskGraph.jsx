'use client';
import { useMemo } from 'react';
import { ReactFlow, Background, Controls } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// Theme tokens (globals.css) so the graph follows light/dark mode.
const COLOR = { COMPLETED: 'var(--ok)', RUNNING: 'var(--info)', FAILED: 'var(--err)', QUEUED: 'var(--muted)', AWAITING_APPROVAL: 'var(--accent)', CANCELLED: 'var(--muted)' };

// Nodes/edges come only from the persisted plan + agent runs. Agents that
// have no run yet are shown as QUEUED — never as animated fake progress.
// The wheel scrolls the page (not the canvas); zoom with the controls.
export function TaskGraph({ task, runs, onSelect }) {
  const runBy = useMemo(() => Object.fromEntries((runs || []).map((r) => [r.agentSlug, r])), [runs]);
  const { nodes, edges } = useMemo(() => {
    const stages = task.plan?.stages || [];
    const nodes = [{ id: '__task', position: { x: 0, y: 0 }, data: { label: `Task · ${task.status}` }, style: { background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--accent)' } }];
    stages.forEach((stage, si) => stage.forEach((slug, i) => {
      const status = runBy[slug]?.status || 'QUEUED';
      nodes.push({ id: slug, position: { x: (si + 1) * 220, y: i * 90 }, data: { label: `${slug}\n${status}` }, style: { background: 'var(--surface)', color: 'var(--text)', border: `2px solid ${COLOR[status] || 'var(--muted)'}`, whiteSpace: 'pre-line', fontSize: 12 } });
    }));
    const edges = (task.plan?.edges || []).map((e, i) => ({ id: `e${i}`, source: e.from, target: e.to, animated: runBy[e.to]?.status === 'RUNNING', style: { stroke: 'var(--accent)' } }));
    (stages[0] || []).forEach((slug) => edges.push({ id: `root-${slug}`, source: '__task', target: slug, style: { stroke: 'var(--border)' } }));
    return { nodes, edges };
  }, [task, runBy]);
  if (!task.plan?.stages?.length) return <div className="state">No plan yet — the orchestrator has not started planning this task.</div>;
  return (
    <div>
      <div className="graph" aria-hidden="true">
        <ReactFlow nodes={nodes} edges={edges} fitView onNodeClick={(_, n) => onSelect?.(n.id)} nodesDraggable={false} zoomOnScroll={false} preventScrolling={false} panOnScroll={false} zoomOnPinch>
          <Background /><Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {/* Text alternative for the graph: the same stages, keyboard reachable. */}
      <ol className="stage-list" aria-label="Execution stages">
        {task.plan.stages.map((stage, i) => (
          <li key={i}>Stage {i + 1}{stage.length > 1 ? ' (parallel)' : ''}:{' '}
            {stage.map((slug, j) => <span key={slug}>{j > 0 && ', '}<button type="button" className="linklike" onClick={() => onSelect?.(slug)}>{slug}</button> <span className="sub">({runBy[slug]?.status || 'QUEUED'})</span></span>)}
          </li>
        ))}
      </ol>
    </div>
  );
}
