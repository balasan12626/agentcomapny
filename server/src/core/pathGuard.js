import fs from 'node:fs';
import path from 'node:path';

// Canonical-path workspace guard: resolves symlinks before checking, so
// traversal (`..`) and symlink escapes are both rejected.

const DEFAULT_DENIED = ['.env', '.env.*', '*.pem', '*.key', 'id_rsa*', '.ssh', '.aws', '.git/config', 'node_modules'];

function globToRegExp(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`(^|/)${esc}(/|$)`);
}

// Resolve the longest existing prefix with realpath, keep the rest literal.
function canonicalize(p) {
  let current = path.resolve(p);
  const rest = [];
  while (!fs.existsSync(current)) {
    rest.unshift(path.basename(current));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.join(fs.realpathSync.native(current), ...rest);
}

export class PathDeniedError extends Error {
  constructor(message) {
    super(message);
    this.code = 'PATH_DENIED';
  }
}

export function createPathGuard({ allowedRoots, deniedPatterns = DEFAULT_DENIED }) {
  if (!allowedRoots?.length) throw new Error('allowedRoots required');
  const roots = allowedRoots.map(canonicalize);
  const denied = deniedPatterns.map(globToRegExp);

  return function check(requested) {
    if (typeof requested !== 'string' || requested.includes('\0')) throw new PathDeniedError('invalid path');
    const real = canonicalize(requested);
    const root = roots.find((r) => real === r || real.startsWith(r + path.sep));
    if (!root) throw new PathDeniedError(`outside allowed workspace: ${requested}`);
    const rel = path.relative(root, real).split(path.sep).join('/');
    if (rel && denied.some((re) => re.test(rel))) throw new PathDeniedError(`denied path: ${rel}`);
    return real;
  };
}

// Archive entry names must be relative, normalized and contained.
export function isSafeArchiveEntry(name) {
  if (typeof name !== 'string' || !name || name.includes('\0')) return false;
  if (path.isAbsolute(name) || /^[a-zA-Z]:/.test(name) || name.startsWith('\\')) return false;
  const norm = path.posix.normalize(name.replace(/\\/g, '/'));
  return !(norm === '..' || norm.startsWith('../'));
}
