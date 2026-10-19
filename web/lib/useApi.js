'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { useOrg } from './org';

// Stale-while-revalidate cache shared by every page: navigating back to a view
// renders its last response immediately and refreshes in the background, and
// identical in-flight requests are made once.
const cache = new Map(); // url -> data
const inflight = new Map(); // url -> Promise

function fetchOnce(url) {
  if (!inflight.has(url)) inflight.set(url, api(url).then((data) => { cache.set(url, data); return data; }).finally(() => inflight.delete(url)));
  return inflight.get(url);
}

export function invalidate(prefix = '') {
  for (const key of cache.keys()) if (key.includes(prefix)) cache.delete(key);
}

// Fetch org-scoped data; path is relative to /orgs/:orgId. Returns real
// loading/error/empty state — never placeholder data. `null` path = skip.
export function useOrgApi(path) {
  const { orgId } = useOrg();
  const url = orgId && path != null ? `/orgs/${orgId}${path}` : null;
  const [state, setState] = useState(() => ({ loading: !(url && cache.has(url)), data: url ? cache.get(url) ?? null : null, error: null }));
  const load = useCallback(async () => {
    if (!url) return setState({ loading: false, data: null, error: null });
    setState((s) => ({ ...s, loading: true, data: s.data ?? cache.get(url) ?? null }));
    try { setState({ loading: false, data: await fetchOnce(url), error: null }); }
    catch (error) { setState({ loading: false, data: null, error }); }
  }, [url]);
  useEffect(() => {
    if (url && cache.has(url)) setState({ loading: true, data: cache.get(url), error: null });
    load();
  }, [load, url]);
  return { ...state, reload: load, orgId };
}
