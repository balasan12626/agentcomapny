'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from './api';

// Live task events: REST replay for history, then WebSocket with
// `sinceSeq` so events missed during a disconnect are replayed server-side.
export function useTaskEvents(orgId, taskId) {
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const lastSeq = useRef(0);

  useEffect(() => {
    if (!orgId || !taskId) return undefined;
    let ws; let closed = false; let attempt = 0; let timer;
    const add = (list) => setEvents((prev) => {
      const fresh = list.filter((e) => e.seq > lastSeq.current);
      if (!fresh.length) return prev;
      lastSeq.current = fresh[fresh.length - 1].seq;
      return [...prev, ...fresh];
    });
    const connect = () => {
      const url = process.env.NEXT_PUBLIC_WS_URL || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:4000/ws`;
      ws = new WebSocket(url);
      ws.onopen = () => { attempt = 0; setConnected(true); ws.send(JSON.stringify({ type: 'subscribe', taskId, sinceSeq: lastSeq.current })); };
      ws.onmessage = (m) => { try { const ev = JSON.parse(m.data); if (ev.type === 'event') add([ev]); } catch {} };
      ws.onclose = () => { setConnected(false); if (!closed) timer = setTimeout(connect, Math.min(30000, 1000 * 2 ** attempt++)); };
    };
    api(`/orgs/${orgId}/tasks/${taskId}/events?since=0`).then(add).catch(() => {}).finally(connect);
    return () => { closed = true; clearTimeout(timer); ws?.close(); };
  }, [orgId, taskId]);

  return { events, connected };
}
