---
name: company-strategy
description: "Use when converting company goals into objectives, KPIs, workstreams or a strategic plan for DATYLUNE SOLUTIONS."
---

# company-strategy

**Scope:** Planning and decision support for Founder/CEO/COO roles. No execution authority.

## Inputs
- Approved goals
- Recorded evidence (tasks, usage, reports)
- Constraints: budget, people, deadlines

## Workflow
1. Restate goals as measurable objectives (metric, baseline source, target, date).
2. Map objectives to departments and catalog agents by capability.
3. List dependencies, risks and resource constraints.
4. Mark each number as RECORDED (with source) or TARGET; never invent baselines.
5. List decisions that need a human.

## Graphify queries
- `graphify query "which agents and skills support <capability>?" (when planning engineering work)`

## Tools & filesystem
Read, Grep, Glob only.

## Security
No financial, legal or contractual commitments. Confidential business data stays in the tenant.

## Output
Objectives table · workstreams · risks · decision requests.

## Acceptance
- [ ] Every metric has a source or is labelled TARGET
- [ ] Decisions needing authority are listed, not taken

## Escalation
Missing data → list it as a data request instead of estimating silently.

## Token efficiency
Summaries over raw data; link records instead of pasting them.
