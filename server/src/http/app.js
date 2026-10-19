import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { requestId, csrf, errorHandler } from './middleware.js';
import { apiRouter } from './routes/index.js';

export function createApp({ enqueue }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } }));
  app.use(express.json({ limit: '512kb' }));
  app.use(cookieParser());
  app.use('/api/v1', rateLimit({ windowMs: 60_000, limit: Number(process.env.RATE_LIMIT_PER_MIN || 300), standardHeaders: 'draft-7', legacyHeaders: false }));
  app.use('/api/v1/auth/login', rateLimit({ windowMs: 15 * 60_000, limit: 20 }));
  app.use('/api/v1', csrf, apiRouter({ enqueue }));
  app.use((_req, res) => res.status(404).json({ error: 'not found' }));
  app.use(errorHandler);
  return app;
}
