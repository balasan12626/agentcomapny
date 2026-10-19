import fs from 'node:fs';
import WebSocket from 'ws';
import { createConnector, backoffMs } from './connector.js';

// Config file (never committed): { controlPlaneUrl, deviceId, allowedRoots, deniedPatterns?, maxConcurrent? }
// Device credential comes from the environment / OS secret store, not the file.
const config = JSON.parse(fs.readFileSync(process.env.DATYLUNE_CONNECTOR_CONFIG || 'connector.config.json', 'utf8'));
const credential = process.env.DATYLUNE_DEVICE_CREDENTIAL;
if (!credential) throw new Error('DATYLUNE_DEVICE_CREDENTIAL is required');
if (!config.controlPlaneUrl.startsWith('wss://') && !/^ws:\/\/(localhost|127\.0\.0\.1)/.test(config.controlPlaneUrl)) {
  throw new Error('controlPlaneUrl must use wss:// (ws:// allowed only for localhost)');
}

let attempt = 0;
function connect() {
  const ws = new WebSocket(`${config.controlPlaneUrl}/device`, { headers: { authorization: `Device ${config.deviceId}:${credential}` } });
  const handlers = [];
  const connector = createConnector({
    config,
    transport: { send: (m) => ws.readyState === ws.OPEN && ws.send(m), onMessage: (h) => handlers.push(h), close: () => ws.close() },
    log: (...a) => console.log('[connector]', ...a),
  });
  ws.on('open', () => { attempt = 0; connector.start(); });
  ws.on('message', (d) => handlers.forEach((h) => h(String(d))));
  ws.on('close', () => { connector.stop(); setTimeout(connect, backoffMs(attempt++)); });
  ws.on('error', (e) => console.error('[connector] socket error:', e.message));
  process.once('SIGINT', () => { connector.stop(); process.exit(0); });
}
connect();
