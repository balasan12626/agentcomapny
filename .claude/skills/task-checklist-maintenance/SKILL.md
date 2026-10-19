---
name: task-checklist-maintenance
description: "Use after every meaningful task to update docs/IMPLEMENTATION_CHECKLIST.md and docs/SESSION_HANDOFF.md with honest status, evidence and token usage."
---

# task-checklist-maintenance

**Scope:** Documentation upkeep; preserves history and task IDs.

## Inputs
- What changed
- Commands run and their results
- Token usage for the task (runtime-reported or session counter delta)

## Workflow
1. Edit only affected rows (server/src/core/checklist.js updateChecklistRow is the reference behaviour).
2. Status: NOT_STARTED, IN_PROGRESS, BLOCKED, IMPLEMENTED, VERIFIED, DEFERRED. VERIFIED only with passing evidence.
3. Fill the Tokens column from real usage; write "n/a" if unmeasured — never estimate silently.
4. Add newly discovered work as new IDs; never renumber.
5. Rewrite SESSION_HANDOFF.md "Current state" and "Next" (keep ≤60 lines).

## Tools & filesystem
Read, Edit on docs/ only.

## Security
No secrets, hostnames or customer data in docs.

## Output
Diff of the changed rows + handoff.

## Acceptance
- [ ] Statuses match real test output
- [ ] Skipped/failed tests recorded as such
- [ ] No row deleted

## Escalation
Evidence contradicts a VERIFIED row → downgrade it and note why.

## Token efficiency
Edit rows in place; never regenerate the whole checklist.

## Checklist
Update affected rows in docs/IMPLEMENTATION_CHECKLIST.md (status, evidence, tokens) via `task-checklist-maintenance`.
