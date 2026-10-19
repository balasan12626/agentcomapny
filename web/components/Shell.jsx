'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Building2, Users, FolderKanban, Bot, Wrench, Library, ListChecks, ShieldCheck, Terminal, Laptop, Plug, Activity, ScrollText, Settings, Bug, Crown, Network } from 'lucide-react';
import { OrgProvider, useOrg } from '@/lib/org';
import { Login } from './Login';
import { Loading, ErrorState } from './States';

const NAV = [
  ['Executive', [['/dashboard', 'Overview', LayoutDashboard], ['/executive', 'Founder & CEO', Crown]]],
  ['Work', [['/tasks', 'Tasks', ListChecks], ['/approvals', 'Approvals', ShieldCheck], ['/sessions', 'Claude Sessions', Terminal]]],
  ['Agents', [['/catalog', 'Company Org', Network], ['/agents', 'Agent Catalog', Bot], ['/agents/builder', 'Agent Builder', Wrench], ['/skills', 'Skills Library', Library]]],
  ['Security', [['/security', 'Defensive Security', Bug]]],
  ['Admin', [['/organizations', 'Organizations', Building2], ['/clients', 'Clients', Users], ['/projects', 'Projects', FolderKanban], ['/devices', 'Devices', Laptop], ['/integrations', 'Integrations', Plug], ['/monitoring', 'Monitoring', Activity], ['/audit', 'Audit', ScrollText], ['/settings', 'Settings', Settings]]],
];

function Frame({ children }) {
  const { me, orgId, setOrgId, status } = useOrg();
  const path = usePathname();
  if (status === 'loading') return <main><Loading /></main>;
  if (status === 'unauthenticated') return <Login />;
  if (status === 'error') return <main><ErrorState error={{ message: 'API unreachable — is the server running?' }} /></main>;
  return (
    <div className="layout">
      <nav className="sidebar nav" aria-label="Primary">
        <div className="brand"><span>DATYLUNE</span> AI OS</div>
        {me.organizations.length > 0 && (
          <label>Organization
            <select value={orgId || ''} onChange={(e) => setOrgId(e.target.value)}>
              {me.organizations.map((o) => <option key={o._id} value={o._id}>{o.name} ({o.role})</option>)}
            </select>
          </label>
        )}
        {NAV.map(([group, items]) => (
          <div key={group}><h2>{group}</h2>
            {items.map(([href, label, Icon]) => <Link key={href} href={href} aria-current={path === href ? 'page' : undefined}><Icon size={16} aria-hidden />{label}</Link>)}
          </div>
        ))}
      </nav>
      <main>{orgId ? children : <div className="state">You are not a member of any organization yet. Ask an Organization Admin to invite you.</div>}</main>
    </div>
  );
}

export function Shell({ children }) {
  return <OrgProvider><Frame>{children}</Frame></OrgProvider>;
}
