---
name: product-requirements
description: "Use when turning an approved request into a PRD, user stories or acceptance criteria."
---

# product-requirements

**Scope:** Product Manager workflow (MetaGPT WritePRD analogue).

## Inputs
- Approved request
- Existing related features (via project-discovery)

## Workflow
1. Write problem, users, goals, non-goals.
2. User stories: As a <role> I want <capability> so that <outcome>.
3. Acceptance criteria: testable, ID'd (AC-1…), each mapped to a test type.
4. List security/privacy requirements and approvals needed.
5. Flag scope questions.

## Graphify queries
- `graphify query "existing code for <feature>"`

## Tools & filesystem
Read, Grep, Glob only.

## Security
Include tenant isolation and least-privilege requirements for any new data or tool.

## Output
PRD markdown ≤ 2 pages.

## Acceptance
- [ ] Every story has ≥1 testable AC
- [ ] Non-goals stated

## Escalation
Ambiguous scope → questions to the requester, not assumptions.

## Token efficiency
Reference existing docs by path rather than restating them.

## Checklist
Update affected rows in docs/IMPLEMENTATION_CHECKLIST.md (status, evidence, tokens) via `task-checklist-maintenance`.
