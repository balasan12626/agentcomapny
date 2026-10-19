// Update a markdown task-register row in place, preserving all other rows,
// IDs and history. Used by agents and the API to keep the checklist honest.

export const CHECKLIST_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'IMPLEMENTED', 'VERIFIED', 'DEFERRED'];

const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function updateChecklistRow(markdown, id, updates) {
  if (updates.status && !CHECKLIST_STATUSES.includes(updates.status)) throw new Error(`invalid status ${updates.status}`);
  if (updates.status === 'VERIFIED' && !updates.evidence) throw new Error('VERIFIED requires verification evidence');
  const lines = markdown.split('\n');
  let header = null;
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith('|')) { header = null; continue; }
    const row = cells(lines[i]);
    if (!header) { header = row.map((h) => h.toLowerCase()); continue; }
    if (row[0] !== id) continue;
    const set = (col, val) => { const j = header.findIndex((h) => h.startsWith(col)); if (j >= 0 && val !== undefined) row[j] = String(val).replace(/\|/g, '\\|').replace(/\n/g, ' '); };
    set('status', updates.status);
    set('verification', updates.evidence);
    set('next', updates.next);
    set('tokens', updates.tokens);
    lines[i] = `| ${row.join(' | ')} |`;
    found = true;
  }
  if (!found) throw new Error(`checklist row ${id} not found`);
  return lines.join('\n');
}
