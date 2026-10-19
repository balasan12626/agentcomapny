---
name: javascript-backend
description: "Use when implementing or changing Node.js JavaScript backend code in server/ (Express routes, services, middleware). Not TypeScript."
---

# javascript-backend

**Scope:** API and services. ESM modules, zod validation, Mongoose.

## Inputs
- Endpoint/service spec
- Relevant tests

## Workflow
1. Route: requireOrg(permission) → validate(zod) → service call; org comes from URL, membership from DB.
2. Every query includes organizationId (and projectId scope when the membership is project-scoped).
3. Long work goes to BullMQ, never inside the HTTP request.
4. Audit sensitive changes via services/audit.js; redact logs.
5. Add/extend tests; run `npm test -w server` and `npm run lint -w server`.

## Graphify queries
- `graphify query "routes using requireOrg"`
- `graphify path "apiRouter" "<Model>"`

## Tools & filesystem
Edit/Write in server/; Bash for npm/node/git (no push without approval).

## Security
Server-side authz on every route; no raw secrets in DB/logs; consistent errors without stack traces.

## Output
Diff summary + test output.

## Acceptance
- [ ] Unit tests pass
- [ ] Cross-tenant access test exists for new data
- [ ] No TypeScript introduced

## Escalation
Needs a schema change → involve database-engineer skill/agent.

## Token efficiency
Read the route file section you change, not the whole router.

## Checklist
Update affected rows in docs/IMPLEMENTATION_CHECKLIST.md (status, evidence, tokens) via `task-checklist-maintenance`.
