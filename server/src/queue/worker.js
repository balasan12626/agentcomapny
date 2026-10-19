import { Worker } from 'bullmq';
import { redis, QUEUE_NAME } from './connection.js';
import { connectDb } from '../config/db.js';
import { executeTask, LIMITS } from '../services/orchestrator.js';
import { Task } from '../models/index.js';
import { transitionTask } from '../services/tasks.js';
import { enqueueTask } from './queue.js';
import { logger } from '../config/logger.js';

const controllers = new Map();

export function createWorker({ processor, lockDuration = 60_000, stalledInterval = 30_000 } = {}) {
  const worker = new Worker(QUEUE_NAME, processor || (async (job) => {
    const ac = new AbortController();
    controllers.set(job.data.taskId, ac);
    try {
      return String((await executeTask({ ...job.data, signal: ac.signal }))?.status);
    } finally {
      controllers.delete(job.data.taskId);
    }
  }), {
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

// Recovery sweep: tasks persisted as QUEUED/RETRYING but missing from the
// queue (crash between DB write and enqueue) are re-submitted. Idempotent.
export async function recoverQueued() {
  const stuck = await Task.find({ status: { $in: ['QUEUED', 'RETRYING'] } }).limit(500);
  for (const t of stuck) {
    if (t.status === 'RETRYING') await transitionTask({ organizationId: t.organizationId, taskId: t._id, to: 'QUEUED' });
    await enqueueTask({ organizationId: t.organizationId, taskId: t._id });
  }
  return stuck.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await connectDb();
  logger.info({ recovered: await recoverQueued() }, 'recovery sweep');
  const worker = createWorker();
  const shutdown = async () => { logger.info('worker shutting down'); await worker.close(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
