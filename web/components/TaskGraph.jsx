'use client';
import { useMemo } from 'react';
import { ReactFlow, Background, Controls } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const COLOR = { COMPLETED: '#22c55e', RUNNING: '#38bdf8', FAILED: '#ef4444', QUEUED: '#9a9ab0', AWAITING_APPROVAL: '#8b5cf6', CANCELLED: '#6b6b80' };

// Nodes/edges come only from the persisted plan + agent runs. Agents that
// have no run yet are shown as QUEUED — never as animated fake progress.
export function TaskGraph({ task, runs, onSelect }) {
  const { nodes, edges } = useMemo(() => {
    const stages = task.plan?.stages || [];
    const runBy = Object.fromEntries((runs || []).map((r) => [r.agentSlug, r]));
    const nodes = [{ id: '__task', position: { x: 0, y: 0 }, data: { label: `Task · ${task.status}` }, style: { background: '#1a1a25', color: '#ececf3', border: '1px solid #8b5cf6' } }];
    stages.forEach((stage, si) => stage.forEach((slug, i) => {
      const status = runBy[slug]?.status || 'QUEUED';
      nodes.push({ id: slug, position: { x: (si + 1) * 220, y: i * 90 }, data: { label: `${slug}\n${status}` }, style: { background: '#13131b', color: '#ececf3', border: `2px solid ${COLOR[status] || '#9a9ab0'}`, whiteSpace: 'pre-line', fontSize: 12 } });
    }));
    const edges = (task.plan?.edges || []).map((e, i) => ({ id: `e${i}`, source: e.from, target: e.to, label: e.artifact, animated: runBy[e.to]?.status === 'RUNNING', style: { stroke: '#3b82f6' }, labelStyle: { fill: '#9a9ab0', fontSize: 10 } }));
    (stages[0] || []).forEach((slug) => edges.push({ id: `root-${slug}`, source: '__task', target: slug, style: { stroke: '#262636' } }));
    return { nodes, edges };
  }, [task, runs]);
  if (!task.plan?.stages?.length) return <div className="state">No plan yet — the orchestrator has not started planning this task.</div>;
  return <div className="graph" aria-label="Agent execution graph"><ReactFlow nodes={nodes} edges={edges} fitView colorMode="dark" onNodeClick={(_, n) => onSelect?.(n.id)} nodesDraggable={false}><Background /><Controls /></ReactFlow></div>;
}
