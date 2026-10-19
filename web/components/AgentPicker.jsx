'use client';
import { useId, useMemo, useState } from 'react';

// Searchable, department-grouped agent picker with removable chips. Replaces
// a 200+ option Ctrl/Cmd-click <select multiple>. Selected slugs are also
// emitted as hidden `name` inputs so it works inside a plain <form>.
export function AgentPicker({ agents, name = 'agents', max = 10, value, onChange }) {
  const [query, setQuery] = useState('');
  const [inner, setInner] = useState([]);
  const selected = value ?? inner;
  const set = (next) => (onChange ? onChange(next) : setInner(next));
  const listId = useId();
  const bySlug = useMemo(() => new Map(agents.map((a) => [a.slug, a])), [agents]);
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = new Map();
    for (const a of agents) {
      if (q && !`${a.name} ${a.slug} ${a.department}`.toLowerCase().includes(q)) continue;
      (out.get(a.department) || out.set(a.department, []).get(a.department)).push(a);
    }
    return [...out.entries()].sort(([x], [y]) => x.localeCompare(y));
  }, [agents, query]);
  const toggle = (slug) => set(selected.includes(slug) ? selected.filter((s) => s !== slug) : selected.length >= max ? selected : [...selected, slug]);
  const shown = groups.reduce((n, [, list]) => n + list.length, 0);

  return (
    <div className="picker">
      <div className="chips" aria-live="polite">
        {selected.length ? selected.map((slug) => (
          <button type="button" className="chip on" key={slug} onClick={() => toggle(slug)} aria-label={`Remove ${bySlug.get(slug)?.name || slug}`}>
            {bySlug.get(slug)?.name || slug} <span aria-hidden>×</span>
          </button>
        )) : <span className="sub">No agents selected yet.</span>}
        {selected.map((slug) => <input key={slug} type="hidden" name={name} value={slug} />)}
      </div>
      <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search agents by name, skill or department" aria-controls={listId} aria-label="Search agents" />
      <p className="sub" style={{ margin: '4px 0' }}>{shown} agent(s) · {selected.length}/{max} selected</p>
      <div className="picker-list" id={listId} role="group" aria-label="Agents">
        {groups.map(([dept, list]) => (
          <fieldset key={dept}>
            <legend>{dept}</legend>
            {list.map((a) => (
              <label key={a.slug} className="check">
                <input type="checkbox" checked={selected.includes(a.slug)} onChange={() => toggle(a.slug)} disabled={!selected.includes(a.slug) && selected.length >= max} />
                <span>{a.name}</span> <span className="sub">{a.kind === 'SUBAGENT' ? 'sub-agent' : a.kind === 'DEPARTMENT_HEAD' ? 'head' : ''}</span>
              </label>
            ))}
          </fieldset>
        ))}
        {!shown && <p className="sub">No agent matches “{query}”.</p>}
      </div>
    </div>
  );
}
