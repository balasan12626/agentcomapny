import path from 'node:path';
import os from 'node:os';

// Workspace isolation: every project gets its own root, and no two projects
// (in any organization on this machine) may share, contain or sit inside each
// other's root. pathGuard bounds what one run may touch; this module bounds
// which roots may be handed out at all. Pure apart from reading the platform.

const WIN = process.platform === 'win32';

// Canonical comparison form: absolute, no trailing separator, case-folded on
// Windows (NTFS is case-insensitive, so C:\A and c:\a are the same folder).
export function normalizeRoot(p, { win = WIN } = {}) {
  const impl = win ? path.win32 : path.posix;
  let out = impl.resolve(String(p));
  if (out.length > impl.parse(out).root.length) out = out.replace(/[\\/]+$/, '');
  return win ? out.toLowerCase() : out;
}

export function rootsOverlap(a, b, opts = {}) {
  const sep = (opts.win ?? WIN) ? '\\' : '/';
  const x = normalizeRoot(a, opts);
  const y = normalizeRoot(b, opts);
  return x === y || x.startsWith(y.endsWith(sep) ? y : y + sep) || y.startsWith(x.endsWith(sep) ? x : x + sep);
}

// Shape checks on a requested root before it is compared with other projects.
// `protectedRoots` are folders no project may contain or live in (the
// DATYLUNE source tree itself), so an agent can never edit the platform or
// collide with its dev servers from inside its own workspace.
export function validateRootShape(root, { protectedRoots = [], win = WIN, home = os.homedir() } = {}) {
  const impl = win ? path.win32 : path.posix;
  const raw = String(root || '').trim();
  if (!raw) return 'workspace root is empty';
  if (raw.includes('\0')) return 'workspace root contains a NUL byte';
  if (!impl.isAbsolute(raw)) return `workspace root must be an absolute path: ${raw}`;
  if (raw.split(/[\\/]+/).includes('..')) return `workspace root must not contain "..": ${raw}`;
  const norm = normalizeRoot(raw, { win });
  if (norm === normalizeRoot(impl.parse(impl.resolve(raw)).root, { win })) return 'a drive or filesystem root cannot be a project workspace';
  if (home && norm === normalizeRoot(home, { win })) return 'your home folder cannot be a project workspace; use a dedicated sub-folder';
  for (const p of protectedRoots) {
    if (rootsOverlap(raw, p, { win })) return 'workspace root overlaps the DATYLUNE application folder';
  }
  return null;
}

// otherProjects: [{ _id, name, organizationId, workspace: { allowedRoots } }]
export function findWorkspaceConflicts(roots, otherProjects, opts = {}) {
  const conflicts = [];
  for (const root of roots) {
    for (const p of otherProjects) {
      for (const other of p.workspace?.allowedRoots || []) {
        if (rootsOverlap(root, other, opts)) conflicts.push({ root, projectId: String(p._id), projectName: p.name, organizationId: String(p.organizationId || ''), otherRoot: other });
      }
    }
  }
  return conflicts;
}

export const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'project';

// Default per-project root under WORKSPACE_BASE: <base>/<client>/<project>.
export function defaultWorkspaceRoot({ base, clientName, projectName, win = WIN }) {
  if (!base) return null;
  return (win ? path.win32 : path.posix).join(base, slugify(clientName), slugify(projectName));
}
