# Hooks

Deterministic checks that do not depend on an agent following its prompt.

| Hook | Event | Effect |
|---|---|---|
| `guard-secrets.mjs` | PreToolUse (Read/Edit/Write/Bash) | Exit 2 (block) on `.env*` (except `.env.example`), keys/certs, `~/.ssh`, `.aws/credentials`, `--dangerously-skip-permissions`, `rm -rf /…`, `git push --force`, `curl | sh`. |

Registered in `.claude/settings.json`; tested by `server/test/unit/hooks.test.js`.
Imported skills may not add hooks: the Skills Library quarantines `hooks/` and executable files until a human reviews them.
