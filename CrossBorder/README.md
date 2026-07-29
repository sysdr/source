# Project Suez — Cross-Border Financial OS

## Run locally (clone → full data)

The committed SQLite file `data/suez.db` is the workspace snapshot (org, ledger, employees, SMTP, etc.). On first load the API rebuilds browser storage from that DB.

**Prerequisites:** Node.js

1. `npm install`
2. Copy `.env.local` keys as needed (`GEMINI_API_KEY`, optional `VITE_SERVER_URL`)
3. Start API + UI (API first so hydration works):

```bash
npm run server   # http://localhost:3001 — serves data/suez.db
npm run dev      # http://localhost:9000
```

Open the app once with the server running; localStorage is filled from SQLite.

### Refresh the shared snapshot (before commit)

```bash
npm run snapshot:data
git add data/suez.db
```

Do not commit `*.db-wal` / `*.db-shm`.

## Testing

- `npm test` / `npm run test:watch`
- CI runs on push and pull request
