// Validates every .claude/skills/*/SKILL.md with the same validator the
// Skills Library API uses, checks agent files are in sync with the catalog,
// and verifies CLAUDE.md documents the real stack.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { validateSkillMarkdown } from '../server/src/core/skillValidator.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const skillsDir = path.join(root, '.claude/skills');
// Pinned upstream skills installed by their own tool (not edited here): they
// must parse and match their folder, but our house style (Acceptance section,
// ≤120 lines) does not apply. Our wrapper skill carries the house rules.
const THIRD_PARTY = { graphify: 'graphifyy==0.9.92 (`graphify install --project`); wrapped by graphify-repository-analysis' };
let count = 0;
for (const dir of fs.readdirSync(skillsDir)) {
  const f = path.join(skillsDir, dir, 'SKILL.md');
  if (!fs.existsSync(f)) continue;
  const text = fs.readFileSync(f, 'utf8');
  const v = validateSkillMarkdown(text);
  count++;
  if (THIRD_PARTY[dir]) {
    const name = /^---[\s\S]*?\nname:\s*["']?([^\n"']+)/.exec(text)?.[1]?.trim();
    if (name !== dir) errors.push(`${dir}: third-party skill frontmatter name "${name}" must match folder`);
    continue;
  }
  if (!v.valid) errors.push(`${dir}: ${v.errors.join('; ')}`);
  if (v.meta?.name !== dir) errors.push(`${dir}: frontmatter name "${v.meta?.name}" must match folder`);
  if (v.warnings.length) errors.push(`${dir}: ${v.warnings.join('; ')}`);
  const lines = text.split('\n').length;
  if (lines > 120) errors.push(`${dir}: ${lines} lines (>120) — keep skills small to save tokens`);
}
const claudeMd = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
for (const must of ['JavaScript', 'MongoDB', 'BullMQ', 'Claude Code', 'Graphify', 'IMPLEMENTATION_CHECKLIST.md', 'SESSION_HANDOFF.md']) {
  if (!claudeMd.includes(must)) errors.push(`CLAUDE.md does not mention ${must}`);
}
try { execFileSync(process.execPath, [path.join(root, 'scripts/generate-claude-agents.mjs'), '--check'], { stdio: 'pipe' }); } catch (e) { errors.push(String(e.stderr || e.message).trim()); }
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`ok: ${count} skills valid, agents in sync, CLAUDE.md consistent`);
