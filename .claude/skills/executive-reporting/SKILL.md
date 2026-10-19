---
name: executive-reporting
description: "Use when producing executive, KPI, operating, cost or weekly reports from recorded DATYLUNE data."
---

# executive-reporting

**Scope:** CEO/CFO/COO/Chief-of-Staff reporting.

## Inputs
- Reporting period
- Task, usage (tokens/cost) and audit records via the API

## Workflow
1. Query /orgs/:orgId/tasks, /usage and /audit for the period.
2. Aggregate: throughput, failures, approvals pending, tokens and cost per task.
3. Compare with approved budgets; flag variances > 10%.
4. Write findings first, then supporting numbers with sources.

## Tools & filesystem
Read, Grep, Glob; API reads only.

## Security
Tenant-scoped data only; redact names/emails in shared summaries.

## Output
Headline (3 bullets) · KPI table with source · risks · asks.

## Acceptance
- [ ] No number without a source record
- [ ] Empty data shown as "no data", not zero

## Escalation
Data unavailable → report the gap.

## Token efficiency
Aggregate server-side; never paste raw event logs.
