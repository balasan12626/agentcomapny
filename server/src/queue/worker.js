import { pathToFileURL } from 'node:url';
import { Worker } from 'bullmq';
import { redis, QUEUE_NAME } from './connection.js';
import { connectDb } from '../config/db.js';
import { executeTask, LIMITS } from '../services/orchestrator.js';
import { Task } from '../models/index.js';
import { transitionTask, closeOpenRuns, isTerminal } from '../services/tasks.js';
import { markStalled, startHeartbeat } from '../services/stalls.js';
import { workerSummary } from '../services/workspaces.js';
import { enqueueTask } from './queue.js';
import { beforeWorkflowTask, afterWorkflowTask } from '../services/workflowAgents.js';
import { logger } from '../config/logger.js';

const controllers = new Map();
const CANCEL_POLL_MS = Number(process.env.CANCEL_POLL_MS || 3000);

// Cancellation is requested through the API process, which only writes the
// task status. Poll it so the running Claude Code process is aborted.
export function watchCancellation({ organizationId, taskId, controller, intervalMs = CANCEL_POLL_MS }) {
  const timer = setInterval(async () => {
    try {
      const t = await Task.findOne({ _id: taskId, organizationId }, { status: 1 }).lean();
      if (!t || t.status === 'CANCELLED' || t.status === 'STALLED') controller.abort();
    } catch { /* transient DB error: keep polling */ }
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

// Any exception inside executeTask used to strand the task in PLANNING or
// RUNNING (BullMQ's retry then hit an invalid transition). Record it instead.
export async function processTask(data, { execute = executeTask, enqueue = enqueueTask } = {}) {
  const { organizationId, taskId } = data;
  const before = await Task.findOne({ _id: taskId, organizationId }, { status: 1, kind: 1 }).lean();
  if (!before || isTerminal(before.status) || before.status === 'STALLED') return before?.status || 'MISSING';
  // Redelivered after a crash mid-run: do not re-run agents behind the user's back.
  if (before.status !== 'QUEUED') {
    if (!['PLANNING', 'RUNNING', 'VALIDATING'].includes(before.status)) return before.status;
    await markStalled({ organizationId, taskId, from: before.status, reason: `the worker stopped while the task was ${before.status}; retry to run it again` });
    return 'STALLED';
  }
  const workflow = before.kind === 'workflow';
  if (workflow) await beforeWorkflowTask({ organizationId, taskId }).catch((err) => logger.error({ taskId, err: err.message }, 'workflow pre-step failed'));
  const ac = new AbortController();
  controllers.set(String(taskId), ac);
  const stopWatch = watchCancellation({ organizationId, taskId, controller: ac });
  try {
    return String((await execute({ ...data, signal: ac.signal }))?.status);
  } catch (err) {
    const now = await Task.findOne({ _id: taskId, organizationId }, { status: 1 }).lean();
    if (now && !isTerminal(now.status) && now.status !== 'STALLED') {
      await closeOpenRuns({ organizationId, taskId, status: 'FAILED', error: err.message });
      await transitionTask({ organizationId, taskId, to: 'FAILED', error: `execution error: ${err.message}` }).catch(() => {});
    }
    logger.error({ taskId, err: err.message }, 'task execution failed');
    return 'FAILED';
  } finally {
    stopWatch();
    controllers.delete(String(taskId));
    // Validate + apply the agent's structured output (or retry / block).
    if (workflow) await afterWorkflowTask({ organizationId, taskId, enqueue }).catch((err) => logger.error({ taskId, err: err.message }, 'workflow post-step failed'));
  }
}

export function createWorker({ processor, lockDuration = 60_000, stalledInterval = 30_000 } = {}) {
  const worker = new Worker(QUEUE_NAME, processor || ((job) => processTask(job.data)), {
    connection: redis(),
    concurrency: LIMITS.maxParallel,
    lockDuration,
    stalledInterval, // stalled jobs (dead worker) are re-delivered
  });
  worker.on('failed', (job, err) => logger.error({ taskId: job?.data?.taskId, err: err.message }, 'task job failed'));
  return worker;
}

export function cancelLocal(taskId) {
  controllers.get(String(taskId))?.abort();
}

// Recovery sweep on start:
//  - QUEUED/RETRYING tasks missing from the queue are re-submitted;
//  - STALLED tasks that never started (stall.from = QUEUED) resume;
//  - tasks left mid-run by a dead worker become STALLED (retry is a human call).
export async function recoverQueued({ selfWorkerId } = {}) {
  let resumed = 0;
  for (const t of await Task.find({ status: 'STALLED', 'stall.from': 'QUEUED' }).limit(500)) {
    try { await transitionTask({ organizationId: t.organizationId, taskId: t._id, to: 'QUEUED', set: { stall: null, error: null } }); resumed += 1; } catch { /* raced */ }
  }
  const others = (await workerSummary()).online - (selfWorkerId ? 1 : 0);
  let interrupted = 0;
  if (others <= 0) {
    for (const t of await Task.find({ status: { $in: ['PLANNING', 'RUNNING', 'VALIDATING'] } }).limit(500)) {
      try { await markStalled({ organizationId: t.organizationId, taskId: t._id, from: t.status, reason: `the worker stopped while the task was ${t.status}; retry to run it again` }); interrupted += 1; } catch { /* raced */ }
    }
  }
  const stuck = await Task.find({ status: { $in: ['QUEUED', 'RETRYING'] } }).limit(500);
  for (const t of stuck) {
    if (t.status === 'RETRYING') await transitionTask({ organizationId: t.organizationId, taskId: t._id, to: 'QUEUED' });
    await enqueueTask({ organizationId: t.organizationId, taskId: t._id });
  }
  return { requeued: stuck.length, resumed, interrupted };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await connectDb();
  const heartbeat = startHeartbeat({ concurrency: LIMITS.maxParallel, activeJobs: () => controllers.size });
  await heartbeat.ready;
  logger.info({ ...(await recoverQueued({ selfWorkerId: heartbeat.workerId })), workerId: heartbeat.workerId }, 'recovery sweep');
  const worker = createWorker();
  const shutdown = async () => { logger.info('worker shutting down'); await worker.close(); await heartbeat.stop(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
