// Stall detection: decide, from persisted facts only, which tasks no worker is
// moving forward. Pure so the thresholds are unit tested without a queue.
//
// A worker writes a heartbeat every few seconds; a task's updatedAt moves on
// every state change and every persisted event. A task is stalled when:
//   - QUEUED longer than `queuedMs` and no worker is online, or
//   - QUEUED longer than `orphanedQueuedMs` even with a worker online (its job
//     is missing from the queue, so it would never be picked up), or
//   - PLANNING/RUNNING/VALIDATING with no activity for `runningIdleMs` and no
//     worker online (the worker that held it died).

export const STALL_DEFAULTS = Object.freeze({
  heartbeatTtlMs: 45_000,
  queuedMs: 10 * 60_000,
  orphanedQueuedMs: 30 * 60_000,
  runningIdleMs: 5 * 60_000,
});

// heartbeats: [{ workerId, lastSeenAt, activeJobs, concurrency, host, pid, startedAt }]
export function workerStatus(heartbeats, now = Date.now(), { heartbeatTtlMs = STALL_DEFAULTS.heartbeatTtlMs } = {}) {
  const list = heartbeats || [];
  const online = list.filter((h) => now - new Date(h.lastSeenAt).getTime() <= heartbeatTtlMs);
  const lastSeenAt = list.reduce((max, h) => (!max || new Date(h.lastSeenAt) > new Date(max) ? h.lastSeenAt : max), null);
  return {
    status: online.length ? 'ONLINE' : list.length ? 'OFFLINE' : 'NEVER_SEEN',
    online: online.length,
    activeJobs: online.reduce((n, h) => n + (h.activeJobs || 0), 0),
    capacity: online.reduce((n, h) => n + (h.concurrency || 0), 0),
    lastSeenAt,
  };
}

const minutes = (ms) => `${Math.round(ms / 60_000)} min`;

// tasks: [{ _id, status, updatedAt }] → [{ taskId, from, reason }]
export function detectStalls(tasks, { now = Date.now(), workerOnline, ...opts } = {}) {
  const t = { ...STALL_DEFAULTS, ...opts };
  const out = [];
  for (const task of tasks || []) {
    const idle = now - new Date(task.updatedAt).getTime();
    let reason = null;
    if (task.status === 'QUEUED') {
      if (!workerOnline && idle > t.queuedMs) reason = `queued for ${minutes(idle)} and no execution worker is online`;
      else if (workerOnline && idle > t.orphanedQueuedMs) reason = `queued for ${minutes(idle)} while a worker is online — the job is likely missing from the queue`;
    } else if (['PLANNING', 'RUNNING', 'VALIDATING'].includes(task.status)) {
      if (!workerOnline && idle > t.runningIdleMs) reason = `no progress for ${minutes(idle)} while ${task.status} and no execution worker is online`;
    }
    if (reason) out.push({ taskId: String(task._id), from: task.status, reason });
  }
  return out;
}
