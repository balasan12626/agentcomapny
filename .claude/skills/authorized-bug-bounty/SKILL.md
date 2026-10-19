---
name: authorized-bug-bounty
description: "Use for authorized bug-bounty or security assessment work; requires a written scope record before any active testing."
---

# authorized-bug-bounty

**Scope:** Bug-Bounty Assistant workflow, enforced by server/src/core/bugBountyScope.js.

## Inputs
- Scope record: program owner, authorized assets, permitted/excluded tests, window, rate limits, data handling, stop conditions, escalation contact

## Workflow
1. Validate scope (validateScope). Missing/unclear → PASSIVE_ONLY: review public docs/source only, ask for clarification.
2. For each target, assessmentMode(host, testType) must be ACTIVE_ALLOWED before any request.
3. Non-destructive tests only, within rate limits; stop on stop-conditions or unexpected PII.
4. Record findings: DISCOVERED → TRIAGED → VALIDATING → CONFIRMED/REJECTED → REMEDIATION_PLANNED → FIXED → RETESTED → CLOSED.
5. Draft disclosure; submission requires human approval (disclosure.submit).

## Tools & filesystem
Read, Grep, Glob. Network testing only via approved task with security.active_test approval.

## Security
Never: unauthorized access, credential theft, phishing, persistence, DoS, uncontrolled scanning, exfiltration. A public program page is not permission for every asset.

## Output
Finding: id · asset · scope ref · severity+rationale · confidence · evidence refs · minimal repro · impact · remediation.

## Acceptance
- [ ] Every action traceable to scope
- [ ] Evidence minimized and retained per policy

## Escalation
Out-of-scope discovery → stop, record, notify escalation contact.

## Token efficiency
Keep evidence as references, not pasted payloads.

## Checklist
Update affected rows in docs/IMPLEMENTATION_CHECKLIST.md (status, evidence, tokens) via `task-checklist-maintenance`.
