import Link from 'next/link';

export const metadata = { title: 'Page not found' };

export default function NotFound() {
  return (
    <div className="state" style={{ maxWidth: 520, margin: '8vh auto', textAlign: 'left' }}>
      <h1>Page not found</h1>
      <p className="sub">This address does not match any DATYLUNE AI OS page. It may have moved, or the link is mistyped.</p>
      <div className="row">
        <Link className="btn" href="/dashboard">Back to Overview</Link>
        <Link className="btn secondary" href="/tasks">Tasks</Link>
        <Link className="btn secondary" href="/clients">Clients</Link>
      </div>
    </div>
  );
}
