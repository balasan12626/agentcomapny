'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';

const OrgContext = createContext({ me: null, orgId: null, setOrgId: () => {}, status: 'loading', logout: async () => {} });

export function OrgProvider({ children }) {
  const [me, setMe] = useState(null);
  const [orgId, setOrgIdState] = useState(null);
  const [status, setStatus] = useState('loading');
  useEffect(() => {
    // Probe first so a signed-out visit shows sign-in without a 401 in the console.
    api('/auth/session').then((s) => {
      if (!s.authenticated) { const e = new Error('signed out'); e.status = 401; throw e; }
      return api('/me');
    }).then((m) => {
      setMe(m);
      let saved = null;
      try { saved = localStorage.getItem('dl_org'); } catch {}
      const ids = m.organizations.map((o) => o._id);
      setOrgIdState(ids.includes(saved) ? saved : ids[0] || null);
      setStatus('ready');
    }).catch((e) => setStatus(e.status === 401 ? 'unauthenticated' : 'error'));
    const expired = () => setStatus('unauthenticated');
    window.addEventListener('dl:unauthenticated', expired);
    return () => window.removeEventListener('dl:unauthenticated', expired);
  }, []);
  // Return to sign-in when the session cookie's expiry passes.
  useEffect(() => {
    if (!me?.sessionExpiresAt) return undefined;
    const ms = new Date(me.sessionExpiresAt).getTime() - Date.now();
    const timer = setTimeout(() => setStatus('unauthenticated'), Math.max(0, Math.min(ms, 2 ** 31 - 1)));
    return () => clearTimeout(timer);
  }, [me?.sessionExpiresAt]);
  const setOrgId = (id) => { setOrgIdState(id); try { localStorage.setItem('dl_org', id); } catch {} };
  const logout = useCallback(async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch {}
    location.assign('/dashboard');
  }, []);
  const role = me?.organizations.find((o) => o._id === orgId)?.role || null;
  return <OrgContext.Provider value={{ me, orgId, setOrgId, status, logout, role }}>{children}</OrgContext.Provider>;
}
export const useOrg = () => useContext(OrgContext);
