// Starts API (:4000), worker and web (:3000, all interfaces) together.
// Ctrl+C stops all three. Run `npm run doctor` first if anything fails.
import { spawn } from 'node:child_process';
import os from 'node:os';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const procs = [
  ['api', ['run', 'dev', '-w', 'server']],
  ['worker', ['run', 'worker', '-w', 'server']],
  ['web', ['run', 'dev', '-w', 'web']],
].map(([name, args]) => {
  const p = spawn(npm, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const tag = (d) => String(d).split('\n').filter(Boolean).forEach((l) => console.log(`[${name}] ${l}`));
  p.stdout.on('data', tag); p.stderr.on('data', tag);
  p.on('exit', (code) => console.log(`[${name}] exited (${code})`));
  return p;
});
const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
console.log(`\nOpen http://localhost:3000${lan ? `  ·  phone on same Wi-Fi: http://${lan}:3000` : ''}\n`);
const stop = () => { procs.forEach((p) => p.kill('SIGTERM')); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
