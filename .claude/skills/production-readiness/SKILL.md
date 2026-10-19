---
name: production-readiness
description: "Use before declaring a phase or release production-ready: security, recovery, monitoring, backups, docs."
---

# production-readiness

**Scope:** Release gate for CTO/QA roles.

## Inputs
- Target release
- Checklist Phase F/G rows

## Workflow
1. Confirm tests, lint, build pass on the release commit (evidence).
2. Confirm security acceptance tests and tenant-isolation tests ran (not skipped).
3. Confirm backup/restore and recovery exercises were actually performed.
4. Confirm monitoring/alerting exists for API, worker, queue, DB.
5. List gaps; readiness = NO if any critical gap.

## Tools & filesystem
Read, Grep, Glob; Bash for verification commands.

## Security
Production deployment is a restricted operation requiring human approval.

## Output
Readiness verdict (YES/NO) + gap list.

## Acceptance
- [ ] Every YES item has evidence
- [ ] Skipped suites make verdict NO

## Escalation
Pressure to ship with gaps → record the risk acceptance by a human.

## Token efficiency
Check evidence links rather than re-running unchanged suites.

## Checklist
Update affected rows in docs/IMPLEMENTATION_CHECKLIST.md (status, evidence, tokens) via `task-checklist-maintenance`.
