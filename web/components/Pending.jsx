// Honest "coming soon" view for modules whose backend is not built yet.
export function Pending({ title, children, workaround }) {
  return (
    <>
      <h1>{title}</h1>
      <p className="sub"><span className="badge s-muted">Coming soon</span> This module is not available yet.</p>
      <div className="state" style={{ textAlign: 'left' }}>
        <p style={{ marginTop: 0 }}>{children}</p>
        {workaround && <p className="sub" style={{ marginBottom: 0 }}>Until then: {workaround}</p>}
      </div>
    </>
  );
}
