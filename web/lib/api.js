'use client';
// Thin API client: same-origin, cookie session, CSRF header on mutations.
export class ApiError extends Error {
  constructor(status, body) { super(body?.error || `HTTP ${status}`); this.status = status; this.body = body; }
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'same-origin',
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(method !== 'GET' ? { 'x-datylune-csrf': '1' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  // An expired or revoked session anywhere sends the user back to sign-in.
  if (res.status === 401 && !path.startsWith('/auth/') && typeof window !== 'undefined') window.dispatchEvent(new Event('dl:unauthenticated'));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

// Human-readable message for an API error (validation issues, pre-flight).
export function errorText(err) {
  if (err?.body?.issues?.length) return err.body.issues.map((i) => `${i.path || 'request'}: ${i.message}`).join('; ');
  return err?.body?.error || err?.message || 'Request failed';
}
