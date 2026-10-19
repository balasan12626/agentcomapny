import http from 'node:http';
import { connectDb } from './config/db.js';
import { logger } from './config/logger.js';
import { createApp } from './http/app.js';
import { attachGateway } from './ws/gateway.js';
import { enqueueTask } from './queue/queue.js';
import { startStallSweeper } from './services/stalls.js';

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET (>=32 chars) is required');
}
await connectDb();
const server = http.createServer(createApp({ enqueue: enqueueTask }));
attachGateway(server);
// The API watches for tasks no worker is moving (the worker may be the thing that died).
startStallSweeper();
const port = Number(process.env.PORT || 4000);
server.listen(port, () => logger.info({ port }, 'DATYLUNE API listening'));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
