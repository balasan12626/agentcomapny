import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createConnector, backoffMs } from '../src/connector.js';

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-conn-'));
  const sent = [];
  const runs = [];
  const runner = (brief, opts) => {
    runs.push({ brief, opts });
    const events = new EventEmitter();
    return { events, done: Promise.resolve({ ok: true, usage: { inputTokens: 1 }, sessionId: 's', final: { summary: 'ok' } }) };
  };
  const c = createConnector({ config: { deviceId: 'd1', allowedRoots: [root], heartbeatMs: 1e9 }, transport: { send: (m) => sent.push(JSON.parse(m)), onMessage: () => {} }, runner });
  return { root, sent, runs, c };
}

test('rejects server-supplied workspace outside the local allowlist', async () => {
  const { sent, runs, c } = setup();
  await c.onMessage(JSON.stringify({ type: 'task.assign', taskId: 't', agentRunId: 'r', workspace: os.homedir(), brief: { prompt: 'x' } }));
  assert.equal(sent[0].type, 'task.rejected');
  assert.equal(runs.length, 0);
});

test('runs allowed task and reports usage', async () => {
  const { root, sent, runs, c } = setup();
  await c.onMessage(JSON.stringify({ type: 'task.assign', taskId: 't', agentRunId: 'r', workspace: root, brief: { prompt: 'x' } }));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(sent.map((m) => m.type), ['task.ack', 'task.result']);
  assert.equal(sent[1].usage.inputTokens, 1);
  assert.equal(runs[0].opts.cwd, fs.realpathSync(root));
});

test('reconnect backoff grows and is capped', () => {
  const fixed = () => 1;
  assert.equal(backoffMs(0, { random: fixed }), 1000);
  assert.equal(backoffMs(3, { random: fixed }), 8000);
  assert.equal(backoffMs(30, { random: fixed }), 60000);
});
