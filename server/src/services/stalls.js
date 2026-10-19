import os from 'node:os';
import { Task, WorkerHeartbeat } from '../models/index.js';
import { detectStalls, STALL_DEFAULTS } from '../core/staleness.js';
import { WORKER_STATES } from '../core/taskStateMachine.js';
import { transitionTask, closeOpenRuns } from './tasks.js';
import { workerSummary } from './workspaces.js';
import { audit } from './audit.js';
import { logger } from '../config/logger.js';

const thresholds = () => ({
  queuedMs: Number(process.env.STALL_QUEUED_MS) || STALL_DEFAULTS.queuedMs,
  orphanedQueuedMs: Number(process.env.STALL_ORPHANED_QUEUED_MS) || STALL_DEFAULTS.orphanedQueuedMs,
  runningIdleMs: Number(process.env.STALL_RUNNING_IDLE_MS) || STALL_DEFAULTS.runningIdleMs,
});

export async function markStalled({ organizationId, taskId, from, reason }) {
  await transitionTask({ organizationId, taskId, to: 'STALLED', error: reason, set: { stall: { from, at: new Date(), reason } } });
  if (from !== 'QUEUED') await closeOpenRuns({ organizationId, taskId, status: 'FAILED', error: `interrupted: ${reason}` });
  await audit({ organizationId, actor: { kind: 'system', id: 'stall-sweeper' }, action: 'task.stalled', target: String(taskId), details: { from, reason } });
}

// Runs in the API process: it must keep working precisely when the worker
// is dead. Optimistic transitions make concurrent sweepers harmless.
export async function sweepStalls({ now = Date.now() } = {}) {
  const worker = await workerSummary(now);
  const tasks = await Task.find({ status: { $in: WORKER_STATES } }, { status: 1, updatedAt: 1, organizationId: 1 }).limit(1000).lean();
  const stalls = detectStalls(tasks, { now, workerOnline: worker.status === 'ONLINE', ...thresholds() });
  let marked = 0;
  for (const s of stalls) {
    const task = tasks.find((t) => String(t._id) === s.taskId);
    try { await markStalled({ organizationId: task.organizationId, taskId: s.taskId, from: s.from, reason: s.reason }); marked += 1; }
    catch (err) { if (err.code !== 'CONFLICT' && err.code !== 'INVALID_TRANSITION') throw err; }
  }
  if (marked) logger.warn({ marked, worker: worker.status }, 'stalled tasks marked');
  return { marked, worker };
}

export function startStallSweeper({ intervalMs = Number(process.env.STALL_SWEEP_MS) || 60_000 } = {}) {
  const tick = () => sweepStalls().catch((err) => logger.error({ err: err.message }, 'stall sweep failed'));
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  setTimeout(tick, 5_000).unref();
  return timer;
}

// Worker liveness: upsert a heartbeat row every `intervalMs`.
export function startHeartbeat({ workerId = `${os.hostname()}:${process.pid}`, concurrency, activeJobs, intervalMs = 10_000 }) {
  const startedAt = new Date();
  const beat = () => WorkerHeartbeat.updateOne({ workerId }, { $set: { host: os.hostname(), pid: process.pid, startedAt, lastSeenAt: new Date(), concurrency, activeJobs: activeJobs() } }, { upsert: true })
    .catch((err) => logger.error({ err: err.message }, 'heartbeat failed'));
  const ready = beat();
  const timer = setInterval(beat, intervalMs);
  timer.unref();
  return { workerId, ready, stop: async () => { clearInterval(timer); await WorkerHeartbeat.deleteOne({ workerId }).catch(() => {}); } };
}
