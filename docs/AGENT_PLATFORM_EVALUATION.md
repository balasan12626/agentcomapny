# Agent-platform evaluation (DATYLUNE AI OS)

Evaluated on 2026-10-19 on the user's Windows 11 PC. Purpose: decide whether to
reuse functionality from external agent platforms in DATYLUNE AI OS, **without**
copying whole apps over the existing product and **without** violating licenses.

All repos were cloned read-only into `tools/agent-platform-evaluation/` (git-ignored;
upstream code is never modified). SHAs and licenses below were read from the actual
checked-out `LICENSE` files and manifests, not from memory.

## Verified clone metadata

| Repo | Upstream | Commit | License (verified) | Stack | Clone |
|---|---|---|---|---|---|
| rea | github.com/morluto/rea | `b999e72` (main) | **MIT** | Node (`@lydell/node-pty`, MCP SDK) | ✅ 4454 files |
| ClauBoard | github.com/Sipoke123/ClauBoard | `7a742d3` (main) | **AGPL-3.0** | Next/React, Radix, motion | ✅ 125 files |
| Mission Control | github.com/agisota/missioncontrol | `8cb3a11` (main) | **MIT** | Next.js, better-sqlite3, `@xyflow/react`, pino | ✅ 216 files |
| Agency | github.com/christag/agency | `b62e995` (master) | **AGPL-3.0** | Python 3.11+, no DB, no Docker | ✅ 139 files |
| agent-dashboard | github.com/bjornjee/agent-dashboard | `b3c04cf` (main) | **MIT** | Go 1.26, **tmux** TUI | ✅ 503 files |

## What each one actually is (source + README review)

- **rea — "Reverse Engineer Anything."** An MCP server for reverse-engineering binaries,
  apps and runtime behavior. **Off-domain** for DATYLUNE (a governed multi-agent *company*
  OS); it is not an agent-orchestration platform and shares no feature surface with the
  priority list. Reusable only as an optional MCP tool a security agent could call — not as
  a "feature of DATYLUNE." Flagged for the user: this is very likely not the repo intended
  for feature reuse.
- **ClauBoard — visual control plane for Claude Code.** Draggable node canvas, per-agent
  tool/file activity, **append-only event stream as the source of truth** (UI is a
  projection). Conceptually the closest to DATYLUNE's live graph — but **AGPL-3.0**.
- **Mission Control — AI agent orchestration dashboard.** 26 panels (tasks, agents, tokens,
  cron, webhooks, pipelines). **MIT**, Next.js, and it already uses **`@xyflow/react`** — the
  same graph library DATYLUNE uses. The only permissively-licensed, same-stack option.
- **Agency — one dashboard for all agents.** Observation → proposal → decision → approval
  workflow, named roles, no database. **AGPL-3.0**, Python (DATYLUNE is JS).
- **agent-dashboard — tmux orchestrator/dispatcher.** TUI across tmux panes, workflow gate
  skills (TDD, conventional commits), PR/test gates. **MIT**, but **Go + tmux; native
  Windows unsupported** (README), WSL+tmux documented as untested.

## License + platform gating (decisive)

- **ClauBoard (AGPL-3.0)** and **Agency (AGPL-3.0)**: copyleft. Copying or merging their
  source into DATYLUNE would subject DATYLUNE to AGPL if DATYLUNE is distributed or offered
  as a network service. **Do not merge their source.** They may be studied for patterns or
  run as separate services behind a documented interface.
- **agent-dashboard**: MIT but **NOT_SUPPORTED on native Windows** (requires tmux). Source
  review only here; a WSL+tmux trial would be a separate, user-authorized step.
- **Mission Control (MIT)** and **rea (MIT)**: permissive; reuse is license-clean. rea is
  off-domain, so Mission Control is the only clean *and* relevant reuse candidate.

## Comparison (verification states)

State key: VERIFIED_WORKING · PARTIALLY_VERIFIED · SOURCE_REVIEW_ONLY · BLOCKED · NOT_SUPPORTED

| Capability | ClauBoard | Mission Control | Agency | agent-dashboard | **DATYLUNE (this repo)** |
|---|---|---|---|---|---|
| Cloned + license verified | ✅ AGPL | ✅ MIT | ✅ AGPL | ✅ MIT | n/a |
| Installed/launched here | SOURCE_REVIEW_ONLY | SOURCE_REVIEW_ONLY | SOURCE_REVIEW_ONLY | NOT_SUPPORTED (no tmux/Win) | VERIFIED_WORKING (API+worker+web+WS running) |
| Real Claude Code execution | source claims | source claims | coordinator only | source claims | **VERIFIED_WORKING** — real `claude -p`, usage/cost recorded |
| Live agent graph | AGPL source | `@xyflow/react` | — | TUI | **VERIFIED_WORKING** — `@xyflow/react` TaskGraph over authed WS |
| CEO-led dynamic team | — | partial | proposal flow | — | **VERIFIED_WORKING** — `core/ceoRouter.js`, `/ceo/plan`+`/ceo/execute` |
| Approval gates | — | yes | yes | hooks | **VERIFIED_WORKING** — payload-hash approvals, non-requester reviewer |
| Workspace restrictions | documented | — | project separation | — | **VERIFIED_WORKING** — `core/pathGuard.js` per-task allowedRoots |
| License fit for merge | ❌ AGPL | ✅ MIT | ❌ AGPL | ✅ MIT (but Win-blocked) | — |

## Recommendation (Phase 7)

**Build natively; do not merge external source.** Evidence:
1. The two platforms closest to DATYLUNE's live-graph/agent-canvas vision (ClauBoard, Agency)
   are **AGPL-3.0** — merging their code is a licensing hazard for a product DATYLUNE intends
   to own/distribute.
2. The permissive, same-stack option (**Mission Control**, MIT, `@xyflow/react`) overlaps
   features DATYLUNE **already implements independently**: CEO orchestration, a live
   `@xyflow/react` task graph fed by a persisted event stream, token/cost tracking, approvals.
3. **agent-dashboard** is Windows-incompatible (tmux) and is a TUI, not a web product.
4. **rea** is off-domain (binary reverse-engineering MCP).

Therefore the highest-value path — already underway in this session — is to **finish
DATYLUNE's own** CEO execution, live graph and real-run pipeline, and borrow only *patterns*
(not code) where useful: e.g. ClauBoard's "UI is a projection of an append-only event stream"
(DATYLUNE already does this via `services/events.js` + the WS gateway), and Mission Control's
panel ideas (tokens/cron/webhooks) as future native panels. If a running external service is
ever wanted, encapsulate it behind a read-only adapter (agent registry / execution / events /
approvals) that maps into DATYLUNE's canonical Task+Agent model — never duplicate its DB.

## Mission Control — install + launch attempt (2026-10-19)

Chosen as the one permissively-licensed, relevant candidate and **installed + launched**:
- `corepack pnpm install` succeeded, but pnpm's security default **ignored native build
  scripts** (`better-sqlite3`, `esbuild`, `sharp`, …). `pnpm rebuild better-sqlite3 esbuild`
  exited 0 but produced **no native binary** (no Node 24 prebuild; no C++ toolchain to compile).
- Launched `next dev` on **http://127.0.0.1:3007** (free port; DATYLUNE's 3000/4000 untouched).
  **Server boots (Next.js 16, ready in 10.6s); `/login` renders; `/` → 307 → `/login`.**
- `require('better-sqlite3')` **fails to load** ("Could not locate the bindings file"), so every
  DB-backed route is unusable. `/api/agents` returns 401 (auth gate, before DB) — not proof of DB.

**Verdict: PARTIALLY_VERIFIED (server + login UI on :3007) / BLOCKED (SQLite native module won't
load on Node 24 without an MSVC build toolchain).** Not installing a system toolchain unprompted
(per the evaluation's own safety rule). This reinforces the recommendation: **do not adopt;
build natively.** Credentials for the local instance are in the git-ignored
`MissionControl/.datylune-eval-credentials.txt` (admin + a strong random password), never committed.

## Not done / staged (honest)

- **No external app was installed or launched** this session (pnpm/Next build, Python venv,
  Go+tmux build). States above are SOURCE_REVIEW_ONLY / NOT_SUPPORTED accordingly — not
  claimed as working. Installing Mission Control (MIT) as a separate reference service is the
  only one worth a supervised next step; it needs pnpm + its own port + a local `.env`.
- agent-dashboard on native Windows: BLOCKED (tmux). A WSL trial is a separate authorized step.
- No upstream source was modified; the eval tree is git-ignored.
