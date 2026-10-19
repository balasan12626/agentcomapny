import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { signToken, verifyToken } from '../core/session.js';
import { authorize } from '../core/permissions.js';
import { Membership, User } from '../models/index.js';

export const SESSION_COOKIE = 'dl_session';

export function requestId(req, res, next) {
  req.id = req.get('x-request-id')?.slice(0, 64) || randomUUID();
  res.set('x-request-id', req.id);
  next();
}

// Cookie-authenticated mutating requests must carry a custom header the
// browser will not attach cross-site (CSRF defence alongside SameSite=Strict).
export function csrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.path === '/auth/login') return next();
  if (req.get('x-datylune-csrf') !== '1') return res.status(403).json({ error: 'CSRF header missing' });
  next();
}

export const SESSION_TTL_MS = 8 * 3600 * 1000;
export const sessionCookieOptions = () => ({ httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: SESSION_TTL_MS, path: '/' });

export function issueSession(res, userId) {
  const token = signToken({ sub: String(userId) }, process.env.SESSION_SECRET, SESSION_TTL_MS);
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  return new Date(Date.now() + SESSION_TTL_MS);
}

export async function authenticate(req, res, next) {
  const payload = verifyToken(req.cookies?.[SESSION_COOKIE], process.env.SESSION_SECRET);
  if (!payload) return res.status(401).json({ error: 'unauthenticated', code: req.cookies?.[SESSION_COOKIE] ? 'SESSION_EXPIRED' : 'NO_SESSION' });
  req.user = await User.findById(payload.sub).lean();
  if (!req.user) return res.status(401).json({ error: 'unauthenticated', code: 'UNKNOWN_USER' });
  // Sliding session: an active user past half the TTL gets a fresh cookie, so
  // a working session never hits the hard 8 h cut-off mid-task.
  const expiresAt = payload.exp - Date.now() < SESSION_TTL_MS / 2 ? issueSession(res, req.user._id) : new Date(payload.exp);
  req.session = { expiresAt };
  next();
}

// Organization comes from the URL; membership is verified server-side.
export function requireOrg(permission) {
  return async (req, res, next) => {
    const organizationId = req.params.orgId;
    if (!mongoose.isValidObjectId(organizationId)) return res.status(400).json({ error: 'invalid organization id' });
    const membership = await Membership.findOne({ organizationId, userId: req.user._id }).lean();
    const projectId = req.params.projectId || req.body?.projectId;
    const decision = authorize(membership, { permission, organizationId, projectId });
    if (!decision.allowed) return res.status(403).json({ error: decision.reason });
    req.membership = membership;
    req.organizationId = organizationId;
    next();
  };
}

export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) return res.status(400).json({ error: 'validation failed', issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    req.valid = parsed.data;
    next();
  };
}

export function errorHandler(err, req, res, _next) {
  const status = err.status || (err.code === 'INVALID_TRANSITION' ? 409 : err.name === 'CastError' ? 400 : 500);
  if (status >= 500) console.error(JSON.stringify({ level: 'error', requestId: req.id, msg: err.message }));
  res.status(status).json({ error: status >= 500 ? 'internal error' : err.message, code: err.code, ...(err.details && status < 500 ? { details: err.details } : {}), requestId: req.id });
}
