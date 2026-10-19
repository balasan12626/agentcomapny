# Architecture

```
Browser (Next.js web/) ──REST /api/v1 (same-origin proxy, cookie + CSRF header)──► API (server/src/index.js)
        └──────── WS /ws (cookie auth, subscribe{taskId,sinceSeq}) ───────────────►  │  ws/gateway.js
                                                                                     ▼
                         MongoDB ◄── services (tasks, events, approvals, audit) ── routes
                            ▲                                   │ enqueue(jobId=taskId)
                            │                                   ▼
                 orchestrator.executeTask ◄── BullMQ worker ◄── Redis
                            │ runClaude(argv, cwd=pathGuard(workspace), tools=resolveTools)
                            ▼
                     Claude Code CLI (stream-json) ──► events + result.usage → TaskEvent / UsageRecord
Connector (connector/, on a Windows/Linux dev box) — outbound WS, local allowlist, heartbeats (server device gateway: TODO B-05)
```

## Client workspace scope
`GET /orgs/:orgId/clients` and `GET /orgs/:orgId/clients/:clientId` are organization-authenticated and additionally filter projects by `Membership.projectIds` when the membership is project-scoped. `GET /orgs/:orgId/projects/:projectId` uses the same project authorization and returns only that project's client/tasks. The sidebar uses the client-list API; client/project pages link to the existing authorized `/tasks/:taskId` graph. There is not yet a separate external-client membership model or client-facing permissions.

`GET /orgs/:orgId/overview`, `/sessions`, and `/usage` aggregate only task IDs visible to the membership. `/overview` derives client/project/task counts and active agent rows from stored records; connector status remains `NOT_CONFIGURED` until a device gateway exists. Workspace roots are returned only to users with project-management permission. Client defaults (`PUT /clients/:clientId/skills`) require access to every project for that client; project assignments (`PUT /projects/:projectId/skills`) are limited to that project. Both accept enabled approved skills only; tasks snapshot slug/version/hash and the orchestrator revalidates that hash before adding skill text to the prompt. Skill content never grants tools. MCP/MCPO transport is not implemented/configured.

## Task lifecycle
`QUEUED → PLANNING → RUNNING → VALIDATING → (AWAITING_APPROVAL) → COMPLETED`, plus PAUSED, NEEDS_INPUT, RETRYING, FAILED, CANCELLED (`core/taskStateMachine.js`).
- Plan = MetaGPT-style stages from agent `watches/produces` (`core/roleGraph.js`).
- AC-1 passes only if every agent run returned a Claude `result` without error and within budget. Other criteria need validators (TODO E-02) or a human `task.accept` approval (requester cannot approve).
- Transitions use optimistic concurrency; events carry a per-task monotonically increasing `seq` for replay.

## Security controls (where)
| Control | Code |
|---|---|
| Session auth (scrypt, HMAC tokens, httpOnly SameSite=Strict) | `core/session.js`, `http/middleware.js` |
| CSRF (custom header on mutations) | `middleware.csrf` |
| Tenant/role/project authz | `core/permissions.js`, `middleware.requireOrg`, `ws/gateway.authorizeSubscription` |
| Approvals (hash-bound, expiring, single-use, no self/agent approval) | `core/approvals.js`, `services/approvals.js` |
| Restricted ops | `core/restrictedOps.js` |
| Workspace paths (realpath, symlink/traversal, denylist) | `core/pathGuard.js` |
| Tools/commands least privilege | `core/toolPolicy.js` |
| Secret redaction | `core/redact.js` (logs, events, audit) |
| Skill import review/quarantine | `core/skillValidator.js` |
| Claude Code hook guard | `.claude/hooks/guard-secrets.mjs` |
| Rate limits, helmet/CSP, body limits | `http/app.js` |
