import { Queue } from 'bullmq';
import { redis, QUEUE_NAME } from './connection.js';

let queue;
export function taskQueue() {
  if (!queue) queue = new Queue(QUEUE_NAME, { connection: redis() });
  return queue;
}

// jobId = taskId makes queue submission idempotent: re-submitting the same
// task (duplicate HTTP delivery, recovery sweep) never enqueues it twice.
export function enqueueTask({ organizationId, taskId, attempts = 2 }) {
  return taskQueue().add('execute', { organizationId: String(organizationId), taskId: String(taskId) }, {
    jobId: String(taskId),
    attempts,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
}
