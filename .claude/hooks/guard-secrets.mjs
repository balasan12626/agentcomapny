// PreToolUse hook: deterministic block on secret files and dangerous shell
// patterns. Exit code 2 blocks the tool call and shows stderr to Claude.
let raw = '';
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw); } catch { process.exit(0); }
  const t = input.tool_input || {};
  const target = String(t.file_path || t.path || t.command || '');
  const secretFile = /(^|[\/\s"'])(\.env(\.[\w-]+)?|id_rsa[\w.]*|[\w.-]+\.(pem|key|p12|pfx)|\.aws\/credentials|\.ssh\/[\w.-]+)(?=$|[\s"'])/;
  const example = /\.env\.example\b/;
  if (secretFile.test(target) && !example.test(target)) {
    process.stderr.write('Blocked by DATYLUNE guard: secret/credential files are off-limits.\n');
    process.exit(2);
  }
  if (input.tool_name === 'Bash' && /(--dangerously-skip-permissions|\brm\s+-rf\s+\/(?!tmp)|git\s+push\s+.*--force|curl[^|]*\|\s*(ba)?sh)/.test(target)) {
    process.stderr.write('Blocked by DATYLUNE guard: high-risk command needs explicit human approval.\n');
    process.exit(2);
  }
  process.exit(0);
});
