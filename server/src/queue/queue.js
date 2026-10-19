import { Queue } from 'bullmq';
import { redis, QUEUE_NAME } from './connection.js';

let queue;
export function taskQueue() {
  if (!queue) queue = new Queue(QUEUE_NAME, { connection: redis() });
  return queue;
}

// jobId = taskId makes queue submission idempotent: re-submitting the same
// task (duplicate HTTP delivery, recovery sweep) never enqueues it twice.
// A finished job with the same id would make BullMQ silently ignore the add
// (a retried task would sit in QUEUED forever), so it is removed first.
export async function enqueueTask({ organizationId, taskId, attempts = 2 }) {
  const existing = await taskQueue().getJob(String(taskId));
  if (existing) {
    const state = await existing.getState();
    if (state === 'completed' || state === 'failed') await existing.remove();
  }
  return taskQueue().add('execute', { organizationId: String(organizationId), taskId: String(taskId) }, {
    jobId: String(taskId),
    attempts,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
}
