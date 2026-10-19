// Checks everything the app needs before `npm run dev`. Prints fixes, no secrets.
import fs from 'node:fs';
import net from 'node:net';
import { execFileSync } from 'node:child_process';

const env = {};
if (fs.existsSync('.env')) for (const l of fs.readFileSync('.env', 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2]; }
const hostPort = (url, def) => { try { const u = new URL(url.replace(/^mongodb(\+srv)?:/, 'http:').replace(/^redis:/, 'http:')); return [u.hostname, Number(u.port) || def]; } catch { return ['127.0.0.1', def]; } };
const reach = ([host, port]) => new Promise((r) => { const s = net.connect({ host, port, timeout: 2000 }, () => { s.end(); r(true); }); s.on('error', () => r(false)); s.on('timeout', () => { s.destroy(); r(false); }); });
const has = (cmd, args = ['--version']) => { try { execFileSync(cmd, args, { stdio: 'pipe' }); return true; } catch { return false; } };

const checks = [
  ['Node.js >= 20', Number(process.versions.node.split('.')[0]) >= 20, 'Install Node.js 20+ from nodejs.org'],
  ['.env exists', fs.existsSync('.env'), 'Run: npm run setup:env'],
  ['SESSION_SECRET set (>=32 chars)', (env.SESSION_SECRET || '').length >= 32, 'Run: npm run setup:env -- --force'],
  ['dependencies installed', fs.existsSync('node_modules/express') || fs.existsSync('server/node_modules/express'), 'Run: npm install'],
  ['MongoDB reachable', await reach(hostPort(env.MONGODB_URI || 'mongodb://127.0.0.1:27017', 27017)), 'Run: docker compose up -d   (or start your own MongoDB and set MONGODB_URI)'],
  ['Redis reachable', await reach(hostPort(env.REDIS_URL || 'redis://127.0.0.1:6379', 6379)), 'Run: docker compose up -d   (or start redis-server)'],
  ['Claude Code CLI (for running tasks)', has(env.CLAUDE_BIN || 'claude'), 'Install Claude Code and log in: npm i -g @anthropic-ai/claude-code && claude'],
];
let ok = true;
for (const [name, pass, fix] of checks) { console.log(`${pass ? '✔' : '✖'} ${name}${pass ? '' : `\n    → ${fix}`}`); if (!pass && !name.startsWith('Claude')) ok = false; }
process.exit(ok ? 0 : 1);
