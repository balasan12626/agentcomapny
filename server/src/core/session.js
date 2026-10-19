import { createHmac, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

// Password hashing (scrypt) and stateless signed session tokens (HMAC-SHA256).
export function hashPassword(password) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [alg, saltHex, hashHex] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}

const b64 = (s) => Buffer.from(s).toString('base64url');

export function signToken(payload, secret, ttlMs = 8 * 60 * 60 * 1000, now = Date.now()) {
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 chars');
  const body = b64(JSON.stringify({ ...payload, exp: now + ttlMs }));
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

export function verifyToken(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    return payload.exp > now ? payload : null;
  } catch {
    return null;
  }
}
