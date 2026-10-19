---
name: mongodb-engineering
description: "Use when adding or changing Mongoose models, indexes, retention, transactions or migrations in server/src/models."
---

# mongodb-engineering

**Scope:** MongoDB is the primary database.

## Inputs
- Query patterns
- Expected volume

## Workflow
1. Tenant-owned docs carry organizationId (required, indexed).
2. Add compound indexes for org/project/status/time access paths.
3. High-volume collections get TTL/retention (TaskEvent: 30 days).
4. Multi-document consistency: transactions on replica sets; otherwise idempotent writes + unique keys.
5. Write a migration/backfill script for changed shapes; never mutate prod ad hoc.

## Graphify queries
- `graphify query "who reads/writes <Model>"`

## Tools & filesystem
Edit server/src/models and server/scripts only.

## Security
Never store passwords, device secrets, API tokens or Claude credentials in plain documents (hashes only, select:false).

## Output
Schema diff + index list + migration note.

## Acceptance
- [ ] Unique keys enforce idempotency where required
- [ ] Indexes match queries

## Escalation
Destructive migration → requires approval (file.delete / policy.change class).

## Token efficiency
Show only changed schema fields.

## Checklist
Update affected rows in docs/IMPLEMENTATION_CHECKLIST.md (status, evidence, tokens) via `task-checklist-maintenance`.
