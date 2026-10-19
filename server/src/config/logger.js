import { redactDeep } from '../core/redact.js';

// Structured JSON logs with redaction. Keep small: no dependency needed.
function write(level, obj, msg) {
  if (typeof obj === 'string') { msg = obj; obj = {}; }
  if (process.env.NODE_ENV === 'test' && level !== 'error') return;
  process.stdout.write(`${JSON.stringify({ level, time: new Date().toISOString(), msg, ...redactDeep(obj) })}\n`);
}
export const logger = { info: (o, m) => write('info', o, m), warn: (o, m) => write('warn', o, m), error: (o, m) => write('error', o, m) };
