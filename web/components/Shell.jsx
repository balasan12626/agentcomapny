'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Building2, Users, FolderKanban, Bot, Wrench, Library, ListChecks, ShieldCheck, Terminal, Laptop, Plug, Activity, ScrollText, Settings, Bug, Crown, Network, MessageSquare, LogOut } from 'lucide-react';
import { OrgProvider, useOrg } from '@/lib/org';
import { useOrgApi } from '@/lib/useApi';
import { Login } from './Login';
import { Loading, ErrorState } from './States';
import { ThemeSwitch } from './ThemeSwitch';

// Modules that are not built yet live in their own group so the primary
// navigation only leads to working pages.
const NAV = [
  ['Home', [['/dashboard', 'Overview', LayoutDashboard]]],
  ['Work', [['/ceo', 'CEO Orchestrator', MessageSquare], ['/tasks', 'Tasks', ListChecks], ['/approvals', 'Approvals', ShieldCheck], ['/sessions', 'Agent Runs', Terminal]]],
  ['Delivery', [['/clients', 'Clients', Users], ['/projects', 'Projects', FolderKanban]]],
  ['Company', [['/catalog', 'Org Chart', Network], ['/executive', 'Leadership', Crown], ['/agents', 'Agents', Bot], ['/skills', 'Skills', Library]]],
  ['Governance', [['/security', 'Security', Bug], ['/audit', 'Audit', ScrollText], ['/monitoring', 'Monitoring', Activity]]],
  ['Admin', [['/integrations', 'Integrations', Plug]]],
  ['Coming soon', [['/agents/builder', 'Agent Builder', Wrench], ['/organizations', 'Organizations', Building2], ['/devices', 'Devices', Laptop], ['/settings', 'Settings', Settings]], true],
];

const TITLES = [
  [/^\/tasks\/[^/]+$/, 'Task'], [/^\/clients\/[^/]+$/, 'Client'], [/^\/projects\/[^/]+$/, 'Project'],
  [/^\/agents\/[^/]+\/chat$/, 'Agent chat'], [/^\/agents\/(?!builder$)[^/]+$/, 'Agent'],
];
function pageTitle(path) {
  for (const [, items] of NAV) for (const [href, label] of items) if (href === path) return label;
  return TITLES.find(([re]) => re.test(path))?.[1] || null;
}

const isActive = (path, href) => path === href || (href !== '/agents' && path.startsWith(`${href}/`)) || (href === '/agents' && /^\/agents\/(?!builder)/.test(path));

function UserMenu() {
  const { me, role, logout } = useOrg();
  const expires = me?.sessionExpiresAt ? new Date(me.sessionExpiresAt) : null;
  return (
    <div className="user-menu">
      <div className="clip" title={me.user.email}><strong>{me.user.name || me.user.email}</strong></div>
      {me.user.name && <div className="sub clip" title={me.user.email}>{me.user.email}</div>}
      <div className="row" style={{ gap: 6, marginTop: 6 }}>
        {role && <span className="badge s-accent">{role.replace(/_/g, ' ')}</span>}
        <button type="button" className="btn secondary small" onClick={logout}><LogOut size={14} aria-hidden /> Sign out</button>
      </div>
      {expires && <div className="sub" style={{ marginTop: 4 }}>Session ends {expires.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>}
      <ThemeSwitch />
    </div>
  );
}

function Frame({ children }) {
  const { me, orgId, setOrgId, status } = useOrg();
  const clients = useOrgApi(status === 'ready' ? '/clients' : null);
  const path = usePathname();
  const [clientSearch, setClientSearch] = useState('');
  const visibleClients = (clients.data || []).filter((client) => client.name.toLowerCase().includes(clientSearch.trim().toLowerCase()));
  // Next re-applies the root metadata title after navigation; set ours after it.
  useEffect(() => {
    const t = pageTitle(path);
    const title = t ? `${t} · DATYLUNE AI OS` : 'DATYLUNE AI OS';
    const apply = () => { if (document.title !== title) document.title = title; };
    apply();
    const timers = [setTimeout(apply, 50), setTimeout(apply, 500)];
    return () => timers.forEach(clearTimeout);
  }, [path, status]);
  if (status === 'loading') return <main><Loading /></main>;
  if (status === 'unauthenticated') return <Login />;
  if (status === 'error') return <main><ErrorState error={{ message: 'API unreachable — is the server running?' }} /></main>;
  return (
    <div className="layout">
      <a href="#main" className="skip-link">Skip to content</a>
      <nav className="sidebar nav" aria-label="Primary">
        <div className="brand"><span>DATYLUNE</span> AI OS</div>
        <UserMenu />
        {me.organizations.length > 0 && (
          <label>Organization
            <select value={orgId || ''} onChange={(e) => setOrgId(e.target.value)} title={me.organizations.find((o) => o._id === orgId)?.name}>
              {me.organizations.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
            </select>
          </label>
        )}
        <div role="group" aria-labelledby="nav-clients">
          <p className="nav-group" id="nav-clients">Clients</p>
          <input id="client-nav-search" type="search" aria-label="Search clients" placeholder="Search clients" value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} />
          {clients.loading && !clients.data && <p className="sub">Loading clients…</p>}
          {clients.error && <p className="s-err" role="alert">Clients unavailable</p>}
          {clients.data && visibleClients.map((client) => {
            const href = `/clients/${client._id}`;
            return <Link key={client._id} href={href} aria-current={path.startsWith(href) ? 'page' : undefined} title={client.name}>
              <Users size={16} aria-hidden />
              <span className="clip" style={{ flex: 1 }}>{client.name}</span>
              <span className="sub">{client.projects.length}</span>
            </Link>;
          })}
        </div>
        {NAV.map(([group, items, soon]) => (
          <div key={group} role="group" aria-labelledby={`nav-${group}`} className={soon ? 'nav-soon' : undefined}>
            <p className="nav-group" id={`nav-${group}`}>{group}</p>
            {items.map(([href, label, Icon]) => <Link key={href} href={href} aria-current={isActive(path, href) ? 'page' : undefined}><Icon size={16} aria-hidden />{label}{soon && <span className="soon">soon</span>}</Link>)}
          </div>
        ))}
      </nav>
      <main id="main" tabIndex={-1}>{orgId ? children : <div className="state">You are not a member of any organization yet. Ask an Organization Admin to invite you.</div>}</main>
    </div>
  );
}

export function Shell({ children }) {
  return <OrgProvider><Frame>{children}</Frame></OrgProvider>;
}
