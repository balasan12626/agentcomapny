'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { useOrg } from './org';

// Fetch org-scoped data; path is relative to /orgs/:orgId. Returns real
// loading/error/empty state — never placeholder data.
export function useOrgApi(path) {
  const { orgId } = useOrg();
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const load = useCallback(async () => {
    if (!orgId) return setState({ loading: false, data: null, error: null });
    setState((s) => ({ ...s, loading: true }));
    try { setState({ loading: false, data: await api(`/orgs/${orgId}${path}`), error: null }); }
    catch (error) { setState({ loading: false, data: null, error }); }
  }, [orgId, path]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load, orgId };
}
