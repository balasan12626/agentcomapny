'use client';
import { useOrgApi } from '@/lib/useApi';

export default function Integrations() {
  const query = useOrgApi('/overview');
  const connector = query.data?.connector;
  return (
    <>
      <h1>Integrations</h1>
      <p className="sub">Connection state is reported from configured services. No integration is labeled connected without a verified handshake.</p>
      {query.error && <p role="alert" className="s-err">Integration status unavailable: {query.error.message}</p>}
      <div className="grid">
        <section className="card">
          <h2 style={{ fontSize: 15 }}>DATYLUNE execution connector</h2>
          <p className="s-warn">{query.loading ? 'Checking status…' : connector?.status === 'CONNECTED' ? 'Connected' : 'Not connected'}</p>
          <p className="sub">{connector?.registeredDevices || 0} registered device(s). The `/device` gateway and enrollment flow are not implemented, so a device cannot currently connect to this application.</p>
        </section>
        <section className="card">
          <h2 style={{ fontSize: 15 }}>Custom MCP / MCPO</h2>
          <p className="s-warn">Not configured</p>
          <p className="sub">This repository has no MCP/MCPO transport or integration record. No external tool server is being called.</p>
        </section>
      </div>
      <h2 className="section-title">Required before connecting a custom server</h2>
      <ul>
        <li>Endpoint and transport type (HTTP/SSE or stdio through an authorized worker).</li>
        <li>Explicit tool allowlist and the organization/projects allowed to use it.</li>
        <li>Authentication method and credential storage outside browser code, task records, and logs.</li>
        <li>Connection health check, audit events, timeout policy, and a safe disconnect/revocation path.</li>
      </ul>
      <p className="sub">Do not enter access tokens or passwords into this page. A live connection requires secure server-side credential provisioning and a verified handshake.</p>
    </>
  );
}