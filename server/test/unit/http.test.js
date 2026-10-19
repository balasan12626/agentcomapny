import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/http/app.js';
import { signToken } from '../../src/core/session.js';

process.env.SESSION_SECRET = 'unit-secret-'.padEnd(40, 'x');
const app = createApp({ enqueue: async () => {} });

test('security baseline without a database', async () => {
  const health = await request(app).get('/api/v1/health').expect(200);
  assert.equal(health.body.db, false);
  assert.equal(health.headers['x-powered-by'], undefined);
  assert.ok(health.headers['content-security-policy']);
  assert.ok(health.headers['x-request-id']);
  await request(app).get('/api/v1/me').expect(401);
  await request(app).get('/api/v1/me').set('Cookie', 'dl_session=forged.token').expect(401);
  const wrongKey = signToken({ sub: 'u1' }, 'y'.repeat(40));
  await request(app).get('/api/v1/me').set('Cookie', `dl_session=${wrongKey}`).expect(401);
  await request(app).post('/api/v1/orgs/x/tasks').send({}).expect(403); // CSRF header missing
  const bad = await request(app).post('/api/v1/auth/login').send({ email: 'not-an-email' }).expect(400);
  assert.equal(bad.body.error, 'validation failed');
  await request(app).get('/nope').expect(404);
});
