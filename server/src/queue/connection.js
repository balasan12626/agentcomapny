import IORedis from 'ioredis';

let conn;
export function redis() {
  if (!conn) conn = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', { maxRetriesPerRequest: null });
  return conn;
}
export const QUEUE_NAME = 'datylune-tasks';
