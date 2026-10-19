const MAP = {
  COMPLETED: 's-ok', VERIFIED: 's-ok', APPROVED: 's-ok', CONSUMED: 's-ok', CLOSED: 's-ok',
  RUNNING: 's-info', PLANNING: 's-info', VALIDATING: 's-info', QUEUED: 's-muted', RETRYING: 's-warn',
  AWAITING_APPROVAL: 's-accent', PENDING: 's-accent', NEEDS_INPUT: 's-warn', PAUSED: 's-warn', BLOCKED: 's-warn',
  FAILED: 's-err', REJECTED: 's-err', CANCELLED: 's-muted', EXPIRED: 's-muted', INVALIDATED: 's-err', STALLED: 's-err',
};
export function StatusBadge({ status }) {
  return <span className={`badge ${MAP[status] || 's-muted'}`}>{String(status || 'UNKNOWN').replace(/_/g, ' ')}</span>;
}
