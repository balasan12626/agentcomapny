import { parseFrontmatter, toList } from './frontmatter.js';
import { isSafeArchiveEntry } from './pathGuard.js';
import { sha256 } from './canonical.js';

export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
export const MAX_SKILL_BYTES = 64 * 1024;
const EXECUTABLE_EXT = /\.(sh|bash|ps1|bat|cmd|exe|dll|so|py|js|mjs|cjs)$/i;
const INJECTION_HINTS = [
  /ignore (all )?(previous|prior) instructions/i,
  /bypass (the )?(policy|approval|permission)/i,
  /grant (yourself|itself) /i,
  /dangerously-skip-permissions/i,
];

// Validate a SKILL.md document. Imported content is untrusted.
export function validateSkillMarkdown(text) {
  const errors = [];
  const warnings = [];
  if (Buffer.byteLength(text || '', 'utf8') > MAX_SKILL_BYTES) errors.push(`SKILL.md exceeds ${MAX_SKILL_BYTES} bytes`);
  const fm = parseFrontmatter(text);
  if (fm.error) return { valid: false, errors: [fm.error], warnings };
  const { name, description } = fm.data;
  if (!name || !SKILL_NAME_RE.test(name)) errors.push('name must be kebab-case, 2-64 chars');
  if (!description || description.length < 20) errors.push('description must explain when to use the skill (>=20 chars)');
  if (description && description.length > 1024) errors.push('description must be <=1024 chars');
  for (const re of INJECTION_HINTS) if (re.test(text)) errors.push(`content contains disallowed instruction pattern: ${re.source}`);
  if (!/##\s*(Workflow|Steps)/i.test(fm.body)) warnings.push('no Workflow section');
  if (!/##\s*Acceptance/i.test(fm.body)) warnings.push('no Acceptance criteria section');
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    meta: { name, description, allowedTools: toList(fm.data['allowed-tools']), hash: sha256(text || '') },
  };
}

// Validate an import bundle: [{ path, content }]. Executables are quarantined.
export function reviewSkillBundle(files) {
  const errors = [];
  const quarantined = [];
  const skillFile = files.find((f) => f.path.replace(/\\/g, '/').split('/').pop() === 'SKILL.md');
  for (const f of files) {
    if (!isSafeArchiveEntry(f.path)) errors.push(`unsafe path in bundle: ${f.path}`);
    else if (EXECUTABLE_EXT.test(f.path) || /(^|\/)hooks?\//.test(f.path)) quarantined.push(f.path);
  }
  if (!skillFile) errors.push('bundle has no SKILL.md');
  const skill = skillFile ? validateSkillMarkdown(skillFile.content) : null;
  if (skill) errors.push(...skill.errors);
  return { valid: errors.length === 0, errors, quarantined, skill, status: quarantined.length ? 'NEEDS_REVIEW' : 'DRAFT' };
}
