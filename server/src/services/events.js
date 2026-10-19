import { EventEmitter } from 'node:events';
import { Task, TaskEvent } from '../models/index.js';
import { redactDeep } from '../core/redact.js';

// In-process fan-out for WebSocket subscribers. Persistence is the source of
// truth; the bus only notifies. Cross-process fan-out uses Redis pub/sub
// (see queue/bus.js) when REDIS_URL is configured.
export const bus = new EventEmitter();
bus.setMaxListeners(1000);

const MAX_EVENT_BYTES = 16 * 1024;

export async function appendEvent({ organizationId, taskId, agentRunId, kind, data }) {
  let safe = redactDeep(data ?? {});
  if (Buffer.byteLength(JSON.stringify(safe)) > MAX_EVENT_BYTES) safe = { truncated: true, kind };
  const task = await Task.findOneAndUpdate({ _id: taskId, organizationId }, { $inc: { lastEventSeq: 1 } }, { new: true, projection: { lastEventSeq: 1 } });
  if (!task) throw new Error('task not found for event');
  const ev = await TaskEvent.create({ organizationId, taskId, agentRunId, seq: task.lastEventSeq, kind, data: safe });
  const out = { taskId: String(taskId), seq: ev.seq, kind, data: safe, at: ev.createdAt };
  bus.emit(`task:${taskId}`, out);
  return out;
}

// Replay for reconnecting clients: everything after `sinceSeq`.
export function eventsSince({ organizationId, taskId, sinceSeq = 0, limit = 500 }) {
  return TaskEvent.find({ organizationId, taskId, seq: { $gt: sinceSeq } }).sort({ seq: 1 }).limit(limit).lean();
}
