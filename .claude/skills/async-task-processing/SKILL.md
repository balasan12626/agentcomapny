---
name: async-task-processing
description: "Use when working on the task queue, worker, retries, cancellation, recovery or execution lifecycle (BullMQ + Redis + Task state machine)."
---

# async-task-processing

**Scope:** server/src/queue/*, services/orchestrator.js, core/taskStateMachine.js.

## Inputs
- Desired lifecycle behaviour

## Workflow
1. Transitions go through transitionTask() (validated + optimistic concurrency).
2. Enqueue with jobId = taskId (idempotent); recoverQueued() resubmits stranded tasks.
3. Retries only for idempotent steps; bounded attempts with backoff.
4. Propagate cancellation via AbortSignal to the Claude process.
5. COMPLETED requires all acceptance criteria PASSED and no pending approvals.
6. Test with real Redis: `npm run test:integration -w server`.

## Graphify queries
- `graphify path "enqueueTask" "executeTask"`

## Tools & filesystem
Edit server/src/{queue,services,core}; Bash for tests.

## Security
Workers re-check workspace authorization immediately before execution.

## Output
Lifecycle diagram (text) + tests.

## Acceptance
- [ ] Crash-recovery test passes
- [ ] No path marks COMPLETED on process exit alone

## Escalation
Redis unavailable → integration tests skip; record as not run.

## Token efficiency
Reuse existing state machine; do not add parallel status fields.

## Checklist
Update affected rows in docs/IMPLEMENTATION_CHECKLIST.md (status, evidence, tokens) via `task-checklist-maintenance`.
