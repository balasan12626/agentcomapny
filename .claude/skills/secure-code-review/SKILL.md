---
name: secure-code-review
description: "Use when reviewing a diff or module for security defects: authz, tenant isolation, injection, path traversal, secrets, unsafe execution."
---

# secure-code-review

**Scope:** Defensive review only.

## Inputs
- Diff or paths
- Threat model if any

## Workflow
1. Map entry points (routes, WS, queue jobs, connector messages).
2. Check each: authn, server-side authz, tenant/project filter, input validation, output encoding.
3. Check process execution uses argv arrays and allowlists (core/toolPolicy.js).
4. Check filesystem access goes through core/pathGuard.js.
5. Check secrets never reach logs/events (core/redact.js).
6. Trace a realistic exploit path before reporting.

## Graphify queries
- `graphify query "which modules spawn processes or read files?"`
- `graphify query "routes without requireOrg"`

## Tools & filesystem
Read, Grep, Glob; Bash only to run tests.

## Security
Do not exploit live systems; review code and test locally.

## Output
Findings: severity · file:line · path · fix. Most severe first.

## Acceptance
- [ ] Each finding has a traced path
- [ ] False positives dropped

## Escalation
Critical finding → notify CISO agent / human immediately.

## Token efficiency
Review the diff plus direct callers only.
