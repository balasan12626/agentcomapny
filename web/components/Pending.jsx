// Honest placeholder for views whose backend is not built yet.
export function Pending({ title, checklistId, children }) {
  return (
    <>
      <h1>{title}</h1>
      <p className="sub">Not implemented yet — tracked as <code>{checklistId}</code> in docs/IMPLEMENTATION_CHECKLIST.md.</p>
      <div className="state">{children}</div>
    </>
  );
}
