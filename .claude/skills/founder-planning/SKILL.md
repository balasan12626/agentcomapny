---
name: founder-planning
description: "Use for founder briefs, prioritized objectives, decision logs, business roadmaps, risk registers or weekly execution reports."
---

# founder-planning

**Scope:** Founder Agent workflow. Read-only, evidence-based.

## Inputs
- Founder goals
- docs/IMPLEMENTATION_CHECKLIST.md
- Task/usage records

## Workflow
1. Pull status from the checklist and task records (not memory).
2. Prioritize with impact × urgency × confidence; show the reasoning in one line each.
3. Update the decision log: decision, date, owner, rationale, reversibility.
4. Update the risk register: risk, likelihood, impact, owner, mitigation.
5. Draft the weekly report: done (with evidence), blocked, next.

## Tools & filesystem
Read, Grep, Glob only.

## Security
Cannot sign, pay, change ownership or self-authorize. Never fabricate metrics.

## Output
Founder brief (≤1 page) + updated logs.

## Acceptance
- [ ] Every "done" item links verification evidence
- [ ] Restricted decisions routed to a human

## Escalation
Conflicting priorities → present options with trade-offs; founder decides.

## Token efficiency
Reuse last week's report as the base; write only the delta.

## Checklist
Update affected rows in docs/IMPLEMENTATION_CHECKLIST.md (status, evidence, tokens) via `task-checklist-maintenance`.
