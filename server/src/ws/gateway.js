import { WebSocketServer } from 'ws';
import cookie from 'cookie';
import mongoose from 'mongoose';
import { verifyToken } from '../core/session.js';
import { authorize, PERMISSIONS } from '../core/permissions.js';
import { Membership, Task } from '../models/index.js';
import { bus, eventsSince } from '../services/events.js';
import { SESSION_COOKIE } from '../http/middleware.js';

// Authenticated, tenant-aware task subscriptions. Clients send
// { type: 'subscribe', taskId, sinceSeq } and receive missed events first.
export async function authorizeSubscription(userId, taskId) {
  if (!mongoose.isValidObjectId(taskId)) return { allowed: false, reason: 'invalid task id' };
  const task = await Task.findById(taskId, { organizationId: 1, projectId: 1 }).lean();
  if (!task) return { allowed: false, reason: 'not found' };
  const membership = await Membership.findOne({ organizationId: task.organizationId, userId }).lean();
  const d = authorize(membership, { permission: PERMISSIONS.read, organizationId: task.organizationId, projectId: task.projectId });
  return d.allowed ? { allowed: true, task } : { allowed: false, reason: 'not found' };
}

export function attachGateway(server, { allowedOrigins = (process.env.WEB_ORIGIN || 'http://localhost:3000').split(',') } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/ws')) return socket.destroy();
    if (req.headers.origin && !allowedOrigins.includes(req.headers.origin)) return socket.destroy();
    const payload = verifyToken(cookie.parse(req.headers.cookie || '')[SESSION_COOKIE], process.env.SESSION_SECRET);
    if (!payload) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
    wss.handleUpgrade(req, socket, head, (ws) => { ws.userId = payload.sub; wss.emit('connection', ws); });
  });

  wss.on('connection', (ws) => {
    const subs = new Map();
    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return ws.send(JSON.stringify({ type: 'error', error: 'bad json' })); }
      if (msg.type !== 'subscribe' || subs.has(msg.taskId) || subs.size >= 20) return;
      const auth = await authorizeSubscription(ws.userId, msg.taskId);
      if (!auth.allowed) return ws.send(JSON.stringify({ type: 'error', taskId: msg.taskId, error: auth.reason }));
      const listener = (ev) => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ type: 'event', ...ev }));
      bus.on(`task:${msg.taskId}`, listener);
      subs.set(msg.taskId, listener);
      const missed = await eventsSince({ organizationId: auth.task.organizationId, taskId: msg.taskId, sinceSeq: Number(msg.sinceSeq) || 0 });
      for (const e of missed) listener({ taskId: msg.taskId, seq: e.seq, kind: e.kind, data: e.data, at: e.createdAt });
    });
    ws.on('close', () => { for (const [id, l] of subs) bus.off(`task:${id}`, l); });
  });
  return wss;
}
