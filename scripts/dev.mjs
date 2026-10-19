// One command for local development: `npm run dev`
//  1. creates .env on first run (random secret, your Wi-Fi IP allowed)
//  2. starts MongoDB + Redis with Docker if they are not already reachable
//  3. seeds the agent catalog and (optionally) the first admin login
//  4. starts API (:4000), worker and web (:3000, reachable from your phone)
// Ctrl+C stops everything it started (Docker containers keep running).
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';

const win = process.platform === 'win32';
const npm = win ? 'npm.cmd' : 'npm';
const run = (cmd, args, env) => spawnSync(cmd, args, { stdio: 'inherit', shell: win, env: { ...process.env, ...env } }).status === 0;
const step = (msg) => console.log(`\n▶ ${msg}`);

function readEnv() {
  const env = {};
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}
function hostPort(url, def) {
  try { const u = new URL(String(url).replace(/^[a-z+]+:/, 'http:')); return [u.hostname, Number(u.port) || def]; } catch { return ['127.0.0.1', def]; }
}
const reachable = ([host, port]) => new Promise((resolve) => {
  const s = net.connect({ host, port, timeout: 2000 }, () => { s.end(); resolve(true); });
  s.on('error', () => resolve(false));
  s.on('timeout', () => { s.destroy(); resolve(false); });
});

if (!fs.existsSync('node_modules')) { step('Installing dependencies'); if (!run(npm, ['install'])) process.exit(1); }
if (!fs.existsSync('.env')) { step('Creating .env'); run(process.execPath, ['scripts/setup-env.mjs']); }
const env = readEnv();

step('Checking MongoDB and Redis');
const mongo = hostPort(env.MONGODB_URI || 'mongodb://127.0.0.1:27017', 27017);
const redis = hostPort(env.REDIS_URL || 'redis://127.0.0.1:6379', 6379);
if (!(await reachable(mongo)) || !(await reachable(redis))) {
  const docker = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore', shell: win }).status === 0;
  if (!docker) {
    console.error('✖ MongoDB/Redis are not running and Docker was not found.\n  Install Docker Desktop, or start MongoDB (replica set) + Redis yourself and set MONGODB_URI / REDIS_URL in .env.');
    process.exit(1);
  }
  console.log('  starting containers with docker compose (first time downloads images)…');
  if (!run('docker', ['compose', 'up', '-d', '--wait'])) {
    console.error('✖ docker compose failed. Is Docker Desktop running?');
    process.exit(1);
  }
}
if (!(await reachable(mongo)) || !(await reachable(redis))) {
  console.error(`✖ Still cannot reach MongoDB (${mongo.join(':')}) or Redis (${redis.join(':')}). Run: npm run doctor`);
  process.exit(1);
}
console.log('  ✔ MongoDB and Redis are up');

step('Seeding agent catalog (safe to repeat)');
if (!run(npm, ['run', 'seed', '-w', 'server'])) process.exit(1);
if (!run(npm, ['run', 'seed:org', '-w', 'server'])) process.exit(1);

if (env.ADMIN_EMAIL && env.ADMIN_PASSWORD) {
  step(`Ensuring admin login ${env.ADMIN_EMAIL}`);
  run(npm, ['run', 'create-admin', '-w', 'server', '--', env.ORG_SLUG || 'datylune', `"${env.ORG_NAME || 'DATYLUNE SOLUTIONS'}"`, env.ADMIN_EMAIL]);
} else {
  console.log('\n  (No ADMIN_EMAIL / ADMIN_PASSWORD in .env — set them to create your first login automatically.)');
}

step('Starting API, worker and web');
const procs = [
  ['api', ['run', 'dev', '-w', 'server']],
  ['worker', ['run', 'worker', '-w', 'server']],
  ['web', ['run', 'dev', '-w', 'web']],
].map(([name, args]) => {
  const p = spawn(npm, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: win });
  const tag = (d) => String(d).split('\n').filter(Boolean).forEach((l) => console.log(`[${name}] ${l}`));
  p.stdout.on('data', tag);
  p.stderr.on('data', tag);
  p.on('exit', (code) => console.log(`[${name}] exited (${code})`));
  return p;
});
const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
console.log(`\n  Open http://localhost:3000${lan ? `   ·   phone on same Wi-Fi: http://${lan}:3000` : ''}\n`);
const stop = () => { procs.forEach((p) => p.kill('SIGTERM')); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
