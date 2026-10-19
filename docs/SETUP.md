# Setup

```bash
npm install
cp .env.example .env            # set SESSION_SECRET (>=32 chars); never commit .env
docker compose up -d            # MongoDB replica set + Redis (or use your own)
set -a; . ./.env; set +a
npm run seed -w server          # platform agent catalog (no tenant data, no metrics)
ADMIN_PASSWORD='<12+ chars>' node server/scripts/create-admin.js datylune "DATYLUNE SOLUTIONS" you@example.com
npm run dev:api & npm run dev:worker & npm run dev:web    # http://localhost:3000
```
The worker runs `claude` on the host and uses your existing Claude Code login — no separate API key is configured here. Create a project with an authorized workspace root before submitting tasks.

Backups: `mongodump --uri "$MONGODB_URI" --archive=backup.gz --gzip`; restore with `mongorestore --archive=backup.gz --gzip`. Restore drills are not yet verified (G-04).
