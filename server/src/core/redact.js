// Secret redaction for logs, events and artifacts. Conservative by design.

const PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{10,}/g,
  /sk-[A-Za-z0-9]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /mongodb(\+srv)?:\/\/[^:\s]+:[^@\s]+@/g,
];
const KV = /\b([A-Z0-9_]*(SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*)\s*[=:]\s*("[^"]*"|'[^']*'|\S+)/gi;

export function redact(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  for (const re of PATTERNS) out = out.replace(re, '[REDACTED]');
  return out.replace(KV, (_m, key) => `${key}=[REDACTED]`);
}

// Exact-ish key names only, so fields like `inputTokens` stay intact.
const SENSITIVE_KEY = /^(.*[_-])?(secret|password|passwd|api[_-]?key|apikey|authorization|cookie|token|access[_-]?token|refresh[_-]?token|session[_-]?token|private[_-]?key|credentials?)$/i;

export function redactDeep(value) {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : redactDeep(v);
    }
    return out;
  }
  return value;
}
