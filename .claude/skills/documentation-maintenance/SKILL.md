---
name: documentation-maintenance
description: "Use when code changes affect setup, architecture, API, security or operations docs in docs/ or README.md."
---

# documentation-maintenance

**Scope:** Keeps docs synchronized with the real implementation.

## Inputs
- Changed behaviour

## Workflow
1. Find docs that mention the changed symbol (`rg -l`).
2. Update the minimal sections; mark unverified items as such.
3. Update docs/ARCHITECTURE.md repo map when files move.
4. Run `npm run validate:claude` if CLAUDE.md or skills changed.

## Graphify queries
- `graphify query "docs referencing <symbol>"`

## Tools & filesystem
Edit docs/, README.md, CLAUDE.md.

## Security
No secrets, internal hostnames or customer data.

## Output
Changed sections list.

## Acceptance
- [ ] Docs match code
- [ ] Validator passes

## Escalation
Doc contradicts code and intent unclear → ask, mark as open issue.

## Token efficiency
Edit sections in place; keep CLAUDE.md under ~150 lines.

## Checklist
Update affected rows in docs/IMPLEMENTATION_CHECKLIST.md (status, evidence, tokens) via `task-checklist-maintenance`.
