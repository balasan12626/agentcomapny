'use client';
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';

const ICON = { pass: CheckCircle2, warn: AlertTriangle, fail: XCircle };
const CLS = { pass: 's-ok', warn: 's-warn', fail: 's-err' };

// True when the only thing stopping dispatch is a missing worker, which a
// human may explicitly override.
export const workerOnlyBlock = (result) => result?.code === 'WORKER_OFFLINE';
// Whether dispatch is blocked, given the user's "Queue anyway" choice.
export const isBlocked = (result, queueAnyway) => !!result && !result.ok && !(workerOnlyBlock(result) && queueAnyway);

// Pre-flight checklist for dispatching work to a project.
export function Preflight({ result, loading, projectHref, queueAnyway, onQueueAnywayChange }) {
  if (loading && !result) return <p className="sub">Checking the project…</p>;
  if (!result) return null;
  const blocked = isBlocked(result, queueAnyway);
  return (
    <section className={`preflight ${blocked ? 'blocked' : ''}`} aria-label="Pre-flight checks" aria-live="polite">
      <strong>{result.ok ? 'Ready to dispatch' : blocked ? 'Cannot dispatch yet' : 'Will queue without a worker'}</strong>
      <ul>
        {result.checks.map((c) => {
          const Icon = ICON[c.status];
          return <li key={c.id} className={CLS[c.status]}><Icon size={15} aria-hidden /> <span className="pf-label">{c.label}</span> <span className="sub">— {c.detail}</span></li>;
        })}
      </ul>
      {workerOnlyBlock(result) && onQueueAnywayChange && (
        <label className="check">
          <input type="checkbox" checked={!!queueAnyway} onChange={(e) => onQueueAnywayChange(e.target.checked)} />
          Queue anyway — I understand nothing runs until a worker starts, and the task may be marked STALLED.
        </label>
      )}
      {!result.ok && !workerOnlyBlock(result) && projectHref && <a href={projectHref}>Fix this on the project →</a>}
    </section>
  );
}

// Inline confirmation after an action (e.g. Retry) was refused because no
// worker is online.
export function QueueAnywayPrompt({ error, onConfirm, onDismiss }) {
  if (error?.body?.code !== 'WORKER_OFFLINE') return null;
  return (
    <div role="alert" className="alert s-warn">
      <p><strong>No execution worker is online.</strong> Start it with <code>npm run dev</code>, or queue the task anyway — it waits and may be marked STALLED.</p>
      <div className="row">
        <button type="button" className="btn small" onClick={onConfirm}>Queue anyway</button>
        <button type="button" className="btn secondary small" onClick={onDismiss}>Not now</button>
      </div>
    </div>
  );
}
