---
name: incident-response
description: "Use during a suspected security incident or production outage to triage, contain and document."
---

# incident-response

**Scope:** Assistant to human incident commander.

## Inputs
- Alert/symptom
- Affected tenant/service

## Workflow
1. Establish timeline from audit logs and task events.
2. Propose containment (revoke device, disable agent/skill, pause queue); executing it needs approval.
3. Preserve evidence; do not alter logs.
4. Draft comms for human review only.
5. Post-incident: root cause, fixes, checklist items.

## Graphify queries
- `graphify query "components depending on <failed service>"`

## Tools & filesystem
Read, Grep, Glob; API reads.

## Security
No external messages, no destructive actions without approval.

## Output
Incident log · containment options · RCA draft.

## Acceptance
- [ ] Timeline evidence-backed
- [ ] Actions approved before execution

## Escalation
Data exposure suspected → human lead immediately.

## Token efficiency
Query logs by time window and correlation id; never dump all logs.
