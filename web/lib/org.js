'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api';

const OrgContext = createContext({ me: null, orgId: null, setOrgId: () => {}, status: 'loading' });

export function OrgProvider({ children }) {
  const [me, setMe] = useState(null);
  const [orgId, setOrgIdState] = useState(null);
  const [status, setStatus] = useState('loading');
  useEffect(() => {
    api('/me').then((m) => {
      setMe(m);
      let saved = null;
      try { saved = localStorage.getItem('dl_org'); } catch {}
      const ids = m.organizations.map((o) => o._id);
      setOrgIdState(ids.includes(saved) ? saved : ids[0] || null);
      setStatus('ready');
    }).catch((e) => setStatus(e.status === 401 ? 'unauthenticated' : 'error'));
  }, []);
  const setOrgId = (id) => { setOrgIdState(id); try { localStorage.setItem('dl_org', id); } catch {} };
  return <OrgContext.Provider value={{ me, orgId, setOrgId, status }}>{children}</OrgContext.Provider>;
}
export const useOrg = () => useContext(OrgContext);
