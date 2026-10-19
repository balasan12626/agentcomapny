import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { buildClaudeArgs, createLineParser, runClaude } from '../../src/adapters/claudeCode.js';

test('builds argv for supported Claude Code print/stream-json mode', () => {
  const args = buildClaudeArgs({ prompt: 'hi; rm -rf /', allowedTools: ['Read', 'Grep'], maxTurns: 5 });
  assert.deepEqual(args.slice(0, 2), ['-p', 'hi; rm -rf /']); // passed as one argv element, no shell
  assert.ok(args.includes('stream-json') && args.includes('--verbose'));
  assert.equal(args[args.indexOf('--allowedTools') + 1], 'Read,Grep');
});

test('line parser handles chunk boundaries and bad lines', () => {
  const got = [];
  const p = createLineParser((e) => got.push(e));
  p.push('{"type":"sys');
  p.push('tem"}\nnot json\n');
  p.end();
  assert.equal(got[0].type, 'system');
  assert.equal(got[1].type, 'parse_error');
});

function fakeSpawn(lines, code = 0) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => { child.killed = true; };
    setImmediate(() => {
      for (const l of lines) child.stdout.write(`${JSON.stringify(l)}\n`);
      child.stdout.end();
      setImmediate(() => child.emit('close', code));
    });
    return child;
  };
}

test('runClaude collects real usage from the result event and redacts output', async () => {
  const h = runClaude({ prompt: 'x' }, { spawnImpl: fakeSpawn([
    { type: 'system', subtype: 'init', session_id: 's1' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'token ghp_abcdefghijklmnopqrstuvwxyz' }] } },
    { type: 'result', subtype: 'success', is_error: false, session_id: 's1', result: 'done', usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.001, num_turns: 1 },
  ]) });
  const events = [];
  h.events.on('event', (e) => events.push(e));
  const res = await h.done;
  assert.equal(res.ok, true);
  assert.equal(res.sessionId, 's1');
  assert.equal(res.usage.inputTokens, 10);
  assert.ok(!JSON.stringify(events).includes('ghp_abcdefghij'));
});

test('a zero exit without a result event is not success', async () => {
  const res = await runClaude({ prompt: 'x' }, { spawnImpl: fakeSpawn([{ type: 'system' }]) }).done;
  assert.equal(res.ok, false);
});
