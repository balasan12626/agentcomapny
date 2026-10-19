// Creates .env from .env.example with a fresh SESSION_SECRET and your LAN IP
// allowed as a web origin (so a phone on the same Wi-Fi can open the app).
import fs from 'node:fs';
import os from 'node:os';
import { randomBytes } from 'node:crypto';

if (fs.existsSync('.env') && !process.argv.includes('--force')) {
  console.log('.env already exists — leaving it unchanged (use --force to regenerate).');
  process.exit(0);
}
const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
let env = fs.readFileSync('.env.example', 'utf8')
  .replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${randomBytes(48).toString('base64url')}`);
if (lan) {
  env = env.replace(/^WEB_ORIGIN=.*$/m, `WEB_ORIGIN=http://localhost:3000,http://${lan}:3000`)
    .replace(/^DEV_ORIGINS=.*$/m, `DEV_ORIGINS=${lan}`);
}
fs.writeFileSync('.env', env, { mode: 0o600 });
console.log(`.env created.${lan ? ` Phone URL (same Wi-Fi): http://${lan}:3000` : ''}`);
