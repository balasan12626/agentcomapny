import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { redactDeep } from '../core/redact.js';
import { usageFromClaudeEvent, addUsage, emptyUsage } from '../core/usage.js';

// Claude Code is the sole AI execution engine. We invoke the official CLI in
// print mode with stream-json output (verified against Claude Code 2.1.x
// `--help`). Arguments are passed as an argv array — never a shell string.
// Authentication is whatever the local Claude Code install already uses.

export function buildClaudeArgs({ prompt, allowedTools = [], disallowedTools = [], permissionMode = 'default', maxTurns, maxBudgetUsd, appendSystemPrompt, addDirs = [], resumeSessionId, model }) {
  if (!prompt || typeof prompt !== 'string') throw new Error('prompt required');
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', permissionMode];
  if (allowedTools.length) args.push('--allowedTools', allowedTools.join(','));
  if (disallowedTools.length) args.push('--disallowedTools', disallowedTools.join(','));
  if (maxTurns) args.push('--max-turns', String(maxTurns));
  if (maxBudgetUsd) args.push('--max-budget-usd', String(maxBudgetUsd));
  if (appendSystemPrompt) args.push('--append-system-prompt', appendSystemPrompt);
  for (const d of addDirs) args.push('--add-dir', d);
  if (resumeSessionId) args.push('--resume', resumeSessionId);
  if (model) args.push('--model', model);
  return args;
}

// Parse NDJSON incrementally; malformed lines become `parse_error` events.
export function createLineParser(onEvent) {
  let buf = '';
  return {
    push(chunk) {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try { onEvent(JSON.parse(line)); } catch { onEvent({ type: 'parse_error', raw: line.slice(0, 500) }); }
      }
    },
    end() { if (buf.trim()) this.push('\n'); },
  };
}

// Normalize a raw CLI event into a compact, sanitized platform event.
export function normalizeEvent(raw) {
  switch (raw.type) {
    case 'system':
      return { kind: 'session', sessionId: raw.session_id, subtype: raw.subtype };
    case 'assistant': {
      const content = raw.message?.content || [];
      const tools = content.filter((c) => c.type === 'tool_use').map((c) => ({ id: c.id, name: c.name }));
      const text = content.filter((c) => c.type === 'text').map((c) => c.text).join('').slice(0, 4000);
      return { kind: tools.length ? 'tool_call' : 'message', text, tools };
    }
    case 'user':
      return { kind: 'tool_result' };
    case 'result':
      return { kind: 'result', subtype: raw.subtype, isError: !!raw.is_error, sessionId: raw.session_id, durationMs: raw.duration_ms, summary: String(raw.result || '').slice(0, 16000), usage: usageFromClaudeEvent(raw) };
    default:
      return { kind: raw.type || 'unknown' };
  }
}

export function runClaude(options, { command = process.env.CLAUDE_BIN || 'claude', cwd, signal, timeoutMs = 15 * 60 * 1000, spawnImpl = spawn } = {}) {
  const emitter = new EventEmitter();
  const args = buildClaudeArgs(options);
  const child = spawnImpl(command, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } });
  let usage = emptyUsage();
  let sessionId = null;
  let final = null;
  let stderr = '';

  const parser = createLineParser((raw) => {
    const ev = redactDeep(normalizeEvent(raw));
    if (ev.sessionId) sessionId = ev.sessionId;
    if (ev.kind === 'result') { final = ev; if (ev.usage) usage = addUsage(usage, ev.usage); }
    emitter.emit('event', ev);
  });
  child.stdout.setEncoding('utf8').on('data', (d) => parser.push(d));
  child.stderr.setEncoding('utf8').on('data', (d) => { stderr = (stderr + d).slice(-4000); });

  const kill = (reason) => { if (!child.killed) child.kill('SIGTERM'); emitter.emit('event', { kind: 'cancelled', reason }); };
  const timer = setTimeout(() => kill('timeout'), timeoutMs);
  signal?.addEventListener('abort', () => kill('cancelled'), { once: true });

  const done = new Promise((resolve) => {
    child.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, exitCode: null, error: err.message, usage, sessionId, final }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      parser.end();
      const ok = code === 0 && final && !final.isError;
      resolve({ ok: !!ok, exitCode: code, usage, sessionId, final, stderr: ok ? undefined : redactDeep(stderr) });
    });
  });
  return { events: emitter, done, pid: child.pid };
}
