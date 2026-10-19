// Minimal YAML frontmatter reader for SKILL.md / agent .md files.
// Supports `key: value`, quoted strings and inline `[a, b]` / comma lists —
// the subset our templates use. Anything else is rejected, not guessed.

export function parseFrontmatter(text) {
  if (typeof text !== 'string') return { error: 'missing frontmatter' };
  const source = text.replace(/\r\n/g, '\n');
  if (!source.startsWith('---\n')) return { error: 'missing frontmatter' };
  const end = source.indexOf('\n---', 4);
  if (end === -1) return { error: 'unterminated frontmatter' };
  const data = {};
  for (const raw of source.slice(4, end).split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!m) return { error: `unsupported frontmatter line: ${line}` };
    let v = m[2].trim();
    if (/^".*"$|^'.*'$/.test(v)) v = v.slice(1, -1);
    else if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    data[m[1]] = v;
  }
  return { data, body: source.slice(end + 4).replace(/^\n/, '') };
}

export function toList(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}
