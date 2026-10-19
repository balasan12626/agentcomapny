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
// Local account folders reveal the machine's user name; keep only `~`.
const HOME_PATHS = [
  /\b[A-Za-z]:(\\\\?|\/)(Users|Documents and Settings)(\\\\?|\/)[^\\/\s"'`<>|]+/gi,
  /(^|[\s"'`(=])\/(home|Users)\/[^/\s"'`<>|]+/g,
];

export function redact(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  for (const re of PATTERNS) out = out.replace(re, '[REDACTED]');
  out = out.replace(HOME_PATHS[0], '~').replace(HOME_PATHS[1], (_m, lead) => `${lead}~`);
  return out.replace(KV, (_m, key) => `${key}=[REDACTED]`);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Replace a project's absolute workspace roots with `<workspace>` so reports
// shown to reviewers (or shared with clients) carry project-relative paths.
// Matches either slash style and is case-insensitive (Windows paths).
function replaceRoots(text, roots) {
  let out = text;
  const sorted = [...roots].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const root of sorted) {
    const parts = String(root).replace(/[\\/]+$/, '').split(/[\\/]+/).map(escapeRe);
    out = out.replace(new RegExp(parts.join('(?:\\\\\\\\|\\\\|/)'), 'gi'), '<workspace>');
  }
  return out;
}

export function redactPaths(text, roots = []) {
  if (typeof text !== 'string') return text;
  return redact(replaceRoots(text, roots));
}

export function redactPathsDeep(value, roots = []) {
  if (typeof value === 'string') return redactPaths(value, roots);
  if (Array.isArray(value)) return value.map((v) => redactPathsDeep(v, roots));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactPathsDeep(v, roots);
    return out;
  }
  return value;
}

// Any absolute path that is not a known workspace root (Windows drive paths,
// UNC shares, common POSIX system/home trees) keeps only its last segment.
const ABS_PATHS = [
  /(?<![A-Za-z0-9<])[A-Za-z]:(?:\\\\|\\|\/)(?:[^\\/\s"'`<>|*?]+(?:\\\\|\\|\/)?)*/g,
  /(?<![A-Za-z0-9:/<])\\\\[^\\\s"'`<>|]+(?:\\[^\\\s"'`<>|]+)*/g,
  /(?<![A-Za-z0-9:/.<>~-])\/(?:home|Users|tmp|var|opt|mnt|srv|root|private|usr|etc|Volumes)(?:\/[^/\s"'`<>|]+)+\/?/g,
];
const lastSegment = (p) => p.replace(/[\\/]+$/, '').split(/[\\/]+/).filter(Boolean).pop() || '';
export const looksLikePath = (text) => typeof text === 'string' && ABS_PATHS.some((re) => { re.lastIndex = 0; return re.test(text); });

export function redactAbsolutePaths(text, roots = []) {
  if (typeof text !== 'string') return text;
  let out = replaceRoots(text, roots);
  for (const re of ABS_PATHS) {
    out = out.replace(re, (m) => {
      // A home folder's own name is the account name: never echo it.
      if (/(?:^|[\\/])(?:Users|home|Documents and Settings)[\\/]+[^\\/]+[\\/]*$/i.test(m)) return '~';
      const seg = lastSegment(m);
      return seg && !/^[A-Za-z]:$/.test(seg) ? `<path>/${seg}` : '<path>';
    });
  }
  return redact(out);
}

// Response-wide redaction. `keep(keyPath)` exempts fields an authorized caller
// may see in full (project settings for workspace managers).
export function redactResponse(value, { roots = [], keep = () => false, path = '' } = {}) {
  if (typeof value === 'string') return keep(path) ? value : redactAbsolutePaths(value, roots);
  if (Array.isArray(value)) return value.map((v, i) => redactResponse(v, { roots, keep, path: `${path}.${i}` }));
  if (value && typeof value === 'object' && !(value instanceof Date) && !(value._bsontype)) {
    const src = typeof value.toJSON === 'function' && !(value instanceof Date) ? value.toJSON() : value;
    if (src !== value) return redactResponse(src, { roots, keep, path });
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactResponse(v, { roots, keep, path: path ? `${path}.${k}` : k });
    return out;
  }
  return value;
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
