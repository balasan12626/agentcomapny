# Session handoff

## Current state (2026-10-19, session 1)
Greenfield build of DATYLUNE AI OS on branch `claude/peaceful-wright-9nolwq`. Monorepo: `server/` (JS API + worker), `connector/`, `web/` (Next.js), `catalog/`, `.claude/` (19 agents, 20 skills, guard hook).
Checks run: `npm test` → server 19/19, connector 3/3 · `npm run test:integration -w server` → queue 2/2 pass, MongoDB suites 2 **skipped** · `npm run lint` ok · `npm run build` ok · `npm run validate:claude` ok.

## Session 2 (2026-10-19)
Added README.md (full start + phone access) and CLAUDE_README.md; scripts `setup:env`, `doctor`, `dev` (starts API + worker + web, web on 0.0.0.0); `.env` loaded via `--env-file-if-exists`; `allowedDevOrigins` from `DEV_ORIGINS`; friendly MongoDB-unreachable exit. Cloud container cannot run the API (no MongoDB) or expose a URL (tunnel hosts blocked).

## Blockers
- Graphify: package install denied in the cloud session → D-01/D-02 BLOCKED. Install locally per docs/GRAPHIFY_INTEGRATION.md.
- MongoDB: no binary/daemon reachable → DB-backed integration tests skipped. Run with `MONGODB_TEST_URI=mongodb://localhost:27017/dltest?replicaSet=rs0`.
- No real `claude -p` task has been executed through the orchestrator yet.

## Decisions
- MetaGPT used as concepts only (watches/produces planning); no Python runtime.
- Agent files generated from `catalog/agents.json`; executives forced read-only.
- `--max-turns` only passed when explicitly configured; mode limits are timeouts.
- Plain CSS design tokens instead of Tailwind/shadcn (fewer deps, build verified) — revisit if wanted.
- No `.claude/CLAUDE.md` duplicate: root CLAUDE.md only (both would load every session, wasting tokens).

## Next (in order)
0. Run locally per README §2–3 and confirm login + task submission on desktop and phone.
1. Install Graphify, build graph, run D-02 checks.
2. Run integration suite against MongoDB; fix findings.
3. Device enrollment + server `/device` gateway (B-05); route tasks to connectors.
4. Validators as acceptance checks (E-02); agent-version write API (C-04).
