export function Loading({ label = 'Loading' }) {
  return <div role="status" aria-label={label} className="card" style={{ display: 'grid', gap: 10 }}><div className="skeleton" /><div className="skeleton" style={{ width: '70%' }} /><div className="skeleton" style={{ width: '40%' }} /></div>;
}
export function ErrorState({ error, onRetry }) {
  return <div role="alert" className="state">Could not load: {error?.message || 'unknown error'} {onRetry && <button className="btn secondary" onClick={onRetry}>Retry</button>}</div>;
}
export function Empty({ children }) {
  return <div className="state">{children}</div>;
}
// Render loading/error/empty consistently for API-backed views.
export function Data({ q, empty, children }) {
  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data || (Array.isArray(q.data) && q.data.length === 0)) return <Empty>{empty}</Empty>;
  return children(q.data);
}
