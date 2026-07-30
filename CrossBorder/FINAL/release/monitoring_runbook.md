# Monitoring runbook — Project Suez 0.2.0

**Status:** local production-like deploy verified 2026-07-30. Full cloud observability (OTLP dashboards, burn-rate paging) is **not wired**; this runbook covers what exists today.

## Synthetic / health

| Check | How | Alert when | Action |
| --- | --- | --- | --- |
| API health | `curl -sf http://127.0.0.1:3001/api/health` → `{"ok":true}` | 3 consecutive failures | Restart `npm run server`; check `data/*.db` locks; restore backup if corrupt |
| Frontend | `curl -sf -o /dev/null -w "%{http_code}" http://127.0.0.1:9000/` → `200` | 3 consecutive failures | Restart `npm run dev` or serve `dist/` via `npm run preview` |
| P0 demo dry-run | `npm run demo:p0` | any flow ≠ passed | Do not advance People flag; triage vs last backup |

Suggested cadence: every 60s for health (local cron or process supervisor); demo dry-run on deploy and daily.

## Four Golden Signals (local)

| Signal | Source today | Notes |
| --- | --- | --- |
| Latency | Browser Network / API logs | No Prometheus scrape yet |
| Traffic | Request volume in server stdout | Manual |
| Errors | HTTP 5xx + console | DAST suite `npm run test:dast` |
| Saturation | Disk for SQLite + Node RSS | Watch `data/` growth |

## Trace / log correlation

Structured `trace_id` end-to-end is **partial**. Until OTel is enabled: correlate by timestamp + route in server logs. File as P2 for Observability Engineer.

## Feature flag rollback

People module: set `localStorage suez_ff_ff_people_module=false` (or clear and ship default-off build). Core ERP remains available.

## Backup / RPO

```bash
npm run backup:db
npm run backup:verify
```

Pre-deploy freshness window: ≤4h. RPO target: ≤24h.

## Escalation

1. Health fail → restart API → verify backup → restore per `FINAL/release/rollback_plan.md`
2. Flag-related UX break → disable `ff_people_module`
3. Data integrity → stop writes, restore last verified backup, re-run `demo:p0`

## Known gaps (accepted at Gate 3)

- No status page notify on deploy
- No automatic canary traffic splitter
- No burn-rate SLO dashboards in production
- External ZAP / VoiceOver / full Stryker still optional (acknowledged)
