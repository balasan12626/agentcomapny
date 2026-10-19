// Requires a local redis-server binary (present in CI image / dev box).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';

const PORT = 6390 + Math.floor(Math.random() * 100);
let redisProc;
let hasRedis = true;
try { execFileSync('redis-server', ['--version']); } catch { hasRedis = false; }

before(async () => {
  if (!hasRedis) return;
  redisProc = spawn('redis-server', ['--port', String(PORT), '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
  process.env.REDIS_URL = `redis://127.0.0.1:${PORT}`;
  await new Promise((r) => setTimeout(r, 400));
});
after(async () => {
  if (!hasRedis) return;
  const { redis } = await import('../../src/queue/connection.js');
  const { taskQueue } = await import('../../src/queue/queue.js');
  await taskQueue().close();
  await redis().quit();
  redisProc.kill();
});

test('duplicate enqueue of the same task yields one job', { skip: !hasRedis && 'redis-server not installed' }, async () => {
  const { enqueueTask, taskQueue } = await import('../../src/queue/queue.js');
  await enqueueTask({ organizationId: 'o1', taskId: 't-dup' });
  await enqueueTask({ organizationId: 'o1', taskId: 't-dup' });
  const counts = await taskQueue().getJobCounts('waiting', 'active', 'delayed');
  assert.equal(counts.waiting + counts.active + counts.delayed, 1);
  await taskQueue().obliterate({ force: true });
});

test('job held by a crashed (SIGKILLed) worker is recovered by another worker', { skip: !hasRedis && 'redis-server not installed', timeout: 20000 }, async () => {
  const { enqueueTask } = await import('../../src/queue/queue.js');
  const { createWorker } = await import('../../src/queue/worker.js');
  await enqueueTask({ organizationId: 'o1', taskId: 't-crash', attempts: 3 });
  // A real worker process takes the job, then dies without completing it.
  const script = `import { createWorker } from ${JSON.stringify(new URL('../../src/queue/worker.js', import.meta.url).href)};
    createWorker({ lockDuration: 1000, stalledInterval: 500, processor: () => { console.log('started'); return new Promise(() => {}); } });`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve) => child.stdout.on('data', (d) => String(d).includes('started') && resolve()));
  child.kill('SIGKILL');
  let recovering;
  const recoveredId = await new Promise((resolve) => {
    recovering = createWorker({ lockDuration: 1000, stalledInterval: 500, processor: async (job) => { resolve(job.data.taskId); return 'ok'; } });
  });
  await recovering.close();
  assert.equal(recoveredId, 't-crash');
});
