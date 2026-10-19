---
name: testing-and-validation
description: "Use when writing, running or reporting tests, lint and builds, or deciding whether acceptance criteria are met."
---

# testing-and-validation

**Scope:** node:test for server/connector, next build for web.

## Inputs
- Acceptance criteria
- Changed files

## Workflow
1. Run the narrowest relevant suite first, then the full fast suite: `npm test`.
2. Integration: `npm run test:integration` (needs Redis; MongoDB via MONGODB_TEST_URI).
3. Config: `npm run validate:claude`. Web: `npm run build`.
4. Reproduce a failure before fixing; show it passing after.
5. Report pass/fail/skip counts exactly as printed.

## Tools & filesystem
Bash for test commands; Edit for test files.

## Security
Never skip, disable or weaken a test to get green. Tests use fixtures, never production data.

## Output
Command · result counts · notable failures.

## Acceptance
- [ ] Reported counts match tool output
- [ ] Skipped tests listed with reason

## Escalation
Environment blocks a suite → mark BLOCKED with the exact error.

## Token efficiency
Pipe output through `tail`/grep for summary lines; do not paste full logs.

## Checklist
Update affected rows in docs/IMPLEMENTATION_CHECKLIST.md (status, evidence, tokens) via `task-checklist-maintenance`.
