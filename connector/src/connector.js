import { createPathGuard } from '@datylune/server/core/pathGuard';
import { runClaude } from '@datylune/server/adapters/claudeCode';
import { redactDeep } from '@datylune/server/core/redact';

// Local execution connector. It dials OUT to the control plane (no inbound
// port, no public shell) and only runs tasks inside directories the device
// owner allowlisted locally — a server-supplied path can never widen that.

export function backoffMs(attempt, { base = 1000, max = 60_000, random = Math.random } = {}) {
  const exp = Math.min(max, base * 2 ** Math.min(attempt, 16));
  return Math.round(exp / 2 + random() * (exp / 2)); // jittered
}

export function createConnector({ config, transport, runner = runClaude, log = () => {} }) {
  const guard = createPathGuard({ allowedRoots: config.allowedRoots, deniedPatterns: config.deniedPatterns });
  const running = new Map();
  let heartbeat;

  const send = (msg) => transport.send(JSON.stringify(redactDeep(msg)));

  async function handleAssign(msg) {
    const { taskId, agentRunId, workspace, brief } = msg;
    let cwd;
    try {
      cwd = guard(workspace); // re-checked right before execution
    } catch (err) {
      return send({ type: 'task.rejected', taskId, agentRunId, reason: err.message });
    }
    if (running.size >= (config.maxConcurrent || 1)) return send({ type: 'task.rejected', taskId, agentRunId, reason: 'device at capacity' });
    send({ type: 'task.ack', taskId, agentRunId });
    const ac = new AbortController();
    const handle = runner({ ...brief, addDirs: [] }, { cwd, signal: ac.signal, timeoutMs: Math.min(brief.timeoutMs || 900_000, 3_600_000) });
    running.set(agentRunId, ac);
    handle.events.on('event', (ev) => send({ type: 'task.event', taskId, agentRunId, event: ev }));
    const res = await handle.done;
    running.delete(agentRunId);
    send({ type: 'task.result', taskId, agentRunId, ok: res.ok, usage: res.usage, sessionId: res.sessionId, summary: res.final?.summary, error: res.ok ? undefined : res.error || res.stderr });
  }

  function onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'task.assign') return handleAssign(msg).catch((e) => log('assign failed', e.message));
    if (msg.type === 'task.cancel') return running.get(msg.agentRunId)?.abort();
    if (msg.type === 'device.revoked') { log('device revoked; stopping'); stop(); }
  }

  function start() {
    transport.onMessage(onMessage);
    send({ type: 'device.hello', deviceId: config.deviceId, version: config.version, allowedRoots: config.allowedRoots.length });
    heartbeat = setInterval(() => send({ type: 'device.heartbeat', deviceId: config.deviceId, running: running.size }), config.heartbeatMs || 15_000);
  }

  function stop() {
    clearInterval(heartbeat);
    for (const ac of running.values()) ac.abort();
    transport.close?.();
  }

  return { start, stop, onMessage, running };
}
