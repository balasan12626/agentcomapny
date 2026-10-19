import { createHash } from 'node:crypto';

// Stable JSON (sorted keys) so the same logical payload always hashes equally.
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export function sha256(input) {
  return createHash('sha256').update(input).digest('hex');
}

export function payloadHash(payload) {
  return sha256(canonicalJson(payload));
}
