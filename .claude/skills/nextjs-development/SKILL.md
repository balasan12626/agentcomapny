---
name: nextjs-development
description: "Use when building or changing the Next.js/React web app in web/ (pages, components, data fetching, live graph UI)."
---

# nextjs-development

**Scope:** Frontend: Next.js App Router, JavaScript/JSX, React Flow for the execution graph.

## Inputs
- Route/component to change
- API contract (server/src/http/routes/index.js)

## Workflow
1. Reuse tokens in web/app/globals.css and components in web/components/.
2. Fetch real data through web/lib/api.js; show loading, error and empty states — no invented metrics.
3. Live updates: web/lib/useTaskEvents.js (WS + replay since lastSeq).
4. Accessibility: labels, focus order, keyboard, contrast.
5. Run `npm run build -w web`.

## Graphify queries
- `graphify query "components that render task state"`

## Tools & filesystem
Edit/Write within web/ only; Bash for npm scripts.

## Security
Never put secrets in client code; mutations send the x-datylune-csrf header; render untrusted text as text (no dangerouslySetInnerHTML).

## Output
Changed files + build result.

## Acceptance
- [ ] `next build` passes
- [ ] States derive from API data
- [ ] Keyboard reachable

## Escalation
API missing for a view → build the empty state and log the API task in the checklist.

## Token efficiency
Edit the one component; avoid reformatting untouched files.

## Checklist
Update affected rows in docs/IMPLEMENTATION_CHECKLIST.md (status, evidence, tokens) via `task-checklist-maintenance`.
