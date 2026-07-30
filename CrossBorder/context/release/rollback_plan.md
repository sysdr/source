# Rollback plan (Gate 3)

1. **Stop traffic** to the new build (or set feature flags off).
2. **Restore SQLite** from last `npm run backup:db` artifact (`npm run backup:verify` first).
3. **Redeploy previous** known-good server + static assets.
4. **Smoke**: `GET /api/health`, open Dashboard, one filing export dry-run.
5. **RTO target**: &lt; 1 hour with verified backup on hand.

Known false positives: health 200 with empty org snapshot after wipe — re-seed with `npm run seed:db` only in non-prod.
