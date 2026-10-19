// Least-privilege tool resolution. Skills may only NARROW an agent's tools;
// a skill requesting a tool the agent policy does not allow is rejected.

export const READ_ONLY_TOOLS = Object.freeze(['Read', 'Grep', 'Glob']);
export const KNOWN_TOOLS = Object.freeze(['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash', 'WebFetch', 'WebSearch', 'Task']);

export function resolveTools({ agentAllowed = READ_ONLY_TOOLS, agentDenied = [], skills = [] }) {
  const allowed = new Set(agentAllowed.filter((t) => !agentDenied.includes(t)));
  const violations = [];
  for (const s of skills) {
    for (const t of s.allowedTools || []) {
      const base = t.split('(')[0];
      if (!allowed.has(base)) violations.push(`skill ${s.name} requests unauthorized tool ${t}`);
    }
  }
  return { tools: [...allowed], violations };
}

// Command policy for Bash: argv arrays only, allowlisted executables.
const DEFAULT_ALLOWED_COMMANDS = ['npm', 'node', 'git', 'npx', 'graphify'];
const DENIED_ARGS = [/^--force$/, /^push$/, /^rm$/, /^-rf$/];

export function checkCommand(argv, { allowedCommands = DEFAULT_ALLOWED_COMMANDS, requireApprovalFor = DENIED_ARGS } = {}) {
  if (!Array.isArray(argv) || argv.length === 0 || argv.some((a) => typeof a !== 'string')) {
    return { allowed: false, reason: 'command must be a non-empty argv array' };
  }
  if (!allowedCommands.includes(argv[0])) return { allowed: false, reason: `command not allowlisted: ${argv[0]}` };
  if (argv.slice(1).some((a) => requireApprovalFor.some((re) => re.test(a)))) {
    return { allowed: false, approvalRequired: true, reason: 'high-risk argument requires approval' };
  }
  return { allowed: true };
}
