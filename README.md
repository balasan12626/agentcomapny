# DATYLUNE AI OS

Governed, multi-tenant, multi-agent operations platform for DATYLUNE SOLUTIONS.
Claude Code is the AI execution engine, MongoDB stores everything, Redis + BullMQ run tasks in the background, and Graphify maps the codebase for agents.

> **Status:** early build — not production-ready. Live status of every feature: [docs/IMPLEMENTATION_CHECKLIST.md](docs/IMPLEMENTATION_CHECKLIST.md).
> Working with Claude Code on this repo? Read [CLAUDE_README.md](CLAUDE_README.md).

---

## 1. What you need

| Tool | Version | Check | Why |
|---|---|---|---|
| Node.js | 20 or newer | `node -v` | API, worker, web |
| Docker Desktop | any recent | `docker -v` | runs MongoDB + Redis for you |
| Git | any | `git --version` | get the code |
| Claude Code | latest | `claude --version` | executes agent tasks (uses your existing login) |

No Docker? Install **MongoDB 7 (as a replica set)** and **Redis 7** yourself and point `MONGODB_URI` / `REDIS_URL` at them in `.env`.

## 2. Get the code

First time:
```bash
git clone https://github.com/balasan12626/agentcomapny.git
cd agentcomapny
git checkout claude/peaceful-wright-9nolwq
```

Get the latest changes later:
```bash
cd agentcomapny
git pull origin claude/peaceful-wright-9nolwq
npm install
```

## 3. Run everything with one command

```bash
npm run dev
```

On the first run this creates `.env`, starts MongoDB + Redis in Docker (Docker Desktop must be open), seeds the agent catalog, then starts the **backend API (:4000), the worker and the frontend (:3000)** together. Ctrl+C stops them.

**First login:** open `.env`, fill in `ADMIN_EMAIL` and `ADMIN_PASSWORD` (12+ characters), then run `npm run dev` again — the admin account is created automatically. Open **http://localhost:3000** and sign in.

If something fails, run `npm run doctor`; it lists exactly what is missing and how to fix it.

## 4. Open it on your phone

1. Phone and computer must be on the **same Wi-Fi**.
2. `npm run dev` prints a line like `phone on same Wi-Fi: http://192.168.1.23:3000` — open that address on the phone.
3. If it does not load:
   - Re-run `npm run setup:env -- --force` if your computer's IP changed (it rewrites `WEB_ORIGIN` and `DEV_ORIGINS` in `.env`), then restart `npm run dev`.
   - Allow Node.js through the firewall (Windows: "Allow an app through Windows Defender Firewall" → Node.js → Private).
   - Some guest/office Wi-Fi blocks device-to-device traffic; use a home network or phone hotspot.

**Away from your Wi-Fi?** Use a tunnel you trust (for example Cloudflare Tunnel or ngrok) pointing at port 3000 and add its hostname to `WEB_ORIGIN` / `DEV_ORIGINS`. This makes your login page public on the internet — use a strong password, and stop the tunnel when you're done. Live updates also need port 4000 (WebSocket) reachable; set `NEXT_PUBLIC_WS_URL` to its public `wss://…/ws` address.

## 5. First steps in the app

1. **Projects** → create a project and enter the folder agents may work in (e.g. `C:\work\client-app`).
2. **Tasks** → pick the project, one or more agents, a mode, write the instruction, submit.
3. Open the task to watch the **live agent graph**, event timeline, and **token usage**.
4. **Approvals** → a different person with approval rights accepts or rejects results and risky actions.
5. **Monitoring** → token consumption per task; **Audit** → who did what.

## 6. Commands

| Command | What it does |
|---|---|
| `npm run dev` | **One command:** env file, MongoDB + Redis (Docker), catalog, admin, then API + worker + web |
| `npm run doctor` | Check Node, `.env`, MongoDB, Redis, Claude Code |
| `npm run setup:env` | Create `.env` (add `-- --force` to regenerate) |
| `npm run dev:api` / `dev:worker` / `dev:web` | Start one part only |
| `npm test` | Unit tests (server + connector) |
| `npm run test:integration` | Queue + database tests (needs Redis; MongoDB via `MONGODB_TEST_URI`) |
| `npm run lint` | Syntax check |
| `npm run build` | Production build of the web app |
| `npm run validate:claude` | Validate `CLAUDE.md`, skills and agents |
| `npm run generate:agents` | Rebuild `.claude/agents/*.md` from `catalog/agents.json` |

## 7. Configuration (`.env`)

| Variable | Meaning |
|---|---|
| `MONGODB_URI` | MongoDB connection (replica set recommended) |
| `REDIS_URL` | Redis for the task queue |
| `SESSION_SECRET` | ≥32 random characters; signs login cookies. Never share. |
| `WEB_ORIGIN` | Browser origins allowed to open live updates (comma-separated) |
| `DEV_ORIGINS` | LAN IPs/hostnames allowed to load the dev web server (phones) |
| `API_URL` | Where the web app forwards `/api/v1` calls (default `http://localhost:4000`) |
| `MAX_PARALLEL_AGENTS`, `MAX_DELEGATION_DEPTH` | Agent concurrency and plan depth limits |
| `CLAUDE_BIN` | Path to the `claude` command |

`.env` is git-ignored. Never commit it.

## 8. Production (outline)

`npm run build`, then run `npm run start -w server`, `npm run worker -w server` and `npm run start -w web` behind HTTPS (reverse proxy), with `NODE_ENV=production` (secure cookies), a managed MongoDB replica set with backups, and Redis with persistence. See [docs/SETUP.md](docs/SETUP.md) and the open items in the checklist (phase G) before going live.

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| Page says "API unreachable" | API is not running — check `npm run dev` output; usually MongoDB is down → `docker compose up -d` |
| `✖ Cannot reach MongoDB` | `docker compose up -d`, wait ~20 s, `npm run doctor` |
| `SESSION_SECRET (>=32 chars) is required` | `npm run setup:env -- --force` |
| Login says invalid credentials | `create-admin` never changes an existing user's password — check the password you first used, or create the admin with a new email (password reset is not built yet) |
| Phone can't connect | See section 4 |
| Tasks stay QUEUED | Worker not running or Redis down → check `[worker]` lines in `npm run dev` |
| Tasks fail immediately | `claude --version` works? Is Claude Code logged in? Does the project folder exist on this computer? |

## 10. Repository layout

```
server/      API, worker, models, core security logic (JavaScript)
connector/   local execution connector (outbound-only)
web/         Next.js web app
catalog/     agent catalog (source of truth)
.claude/     Claude Code agents, skills, hooks, settings
docs/        architecture, setup, checklist, handoff, integrations
scripts/     dev, doctor, setup-env, generators, validators
```

More: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/GRAPHIFY_INTEGRATION.md](docs/GRAPHIFY_INTEGRATION.md) · [docs/METAGPT_ADAPTATION.md](docs/METAGPT_ADAPTATION.md)
